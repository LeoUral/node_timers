require("dotenv").config();

const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const nunjucks = require("nunjucks");
const { nanoid } = require("nanoid");
const { URL } = require("url");
const crypto = require("crypto");
const { MongoClient, ObjectId } = require("mongodb");

const clientPromise = new MongoClient(process.env.DB_URI, {
  useUnifiedTopology: true,
  maxPoolSize: 10,
});
const app = express();

app.set("view engine", "njk");
app.use(express.static("public"));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ clientTracking: false, noServer: true });
const clients = new Map();

const secret = "abcdefg";

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});

app.use(async (req, res, next) => {
  try {
    const client = await clientPromise.connect();
    req.db = client.db("timers");
    next();
  } catch (err) {
    console.log(`Ошибка на момент создания клиента: `, err);
    next(err);
  }
});

const DB = async () => {
  const client = await clientPromise.connect();
  return client.db("timers");
};

//* создаем нового пользователя
const createNewUser = async (db, username, password) => {
  if (await findUserInDataBase(db, username)) {
    console.log("Такой пользователь уже есть!");
    return false;
  }
  await db.collection("users").insertOne({
    username: username,
    password: crypto.createHash("sha256", secret).update(password).digest("hex"),
  });
  console.log(`Новый пользователь создан: ${username}`); //test
  return true;
};

//* поиск пользователя по имени в БД
const findUserInDataBase = async (db, username) => {
  return db.collection("users").findOne({ username });
};

//* поиск пользователя по id сессии в БД
const findUserInSession = async (db, sessionId) => {
  const session = await db.collection("sessions").findOne({ sessionId }, { projection: { userId: 1 } });

  if (!session) {
    return;
  }

  return db.collection("users").findOne({ _id: ObjectId(session.userId) });
};

//* создаем сессию
const createSession = async (db, userId) => {
  const sessionId = nanoid();
  await db.collection("sessions").insertOne({
    userId,
    sessionId,
  });
  console.log(`создана сессия: ${sessionId}`); //test
  return sessionId;
};

//* удаляем сессию
const deleteSession = async (db, sessionId) => {
  await db.collection("sessions").deleteOne({ sessionId });

  console.log(`сессия: ${sessionId}, удалена`); //test
};

app.get("/", (req, res) => {
  res.render("index", {
    user: req.user,
    authError: req.query.authError === "true" ? "Wrong username or password" : req.query.authError,
  });
});

//* обрабатываем полученные данные при входе
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await findUserInDataBase(req.db, username);

  if (!user || user.password !== crypto.createHash("sha256", secret).update(password).digest("hex")) {
    return res.redirect("/?authError=true");
  }
  const sessionId = await createSession(req.db, user._id);
  console.log(`sessionId >>> `, sessionId); // test
  req.user = user;
  req.sessionId = sessionId;

  const userId = {};
  userId.id = user._id;
  userId.username = user.username;

  res.json({ sessionId, userId });
});

//* обрабатываем регистрацию пользователя
app.post("/signup", async (req, res) => {
  const { username, password } = req.body;
  const result = await createNewUser(req.db, username, password);

  if (result) {
    res.json(true);
  } else {
    res.json(false);
  }
});

//todo получаем активные таймеры указанного пользвателя
const getAllTimers = async (DB, userId) => {
  const filteredTimers = await DB.collection("timers").find({ userId: userId }).toArray();
  if (!filteredTimers) {
    return [];
  }
  return filteredTimers;
};

//*TODO CREATE NEW TIMER
const newTimer = async (DB, description, userId) => {
  try {
    const timerId = await DB.collection("timers").insertOne({
      id: "",
      start: Date.now(),
      end: null,
      progress: 0,
      description: description,
      duration: 0,
      isActive: true,
      userId: userId,
    });

    //формируем строчное значение ID, создаем объект
    const newIdTimer = { id: timerId.insertedId.toString() };

    // внесем дополнительное поле ID, для frontend
    await DB.collection("timers").findOneAndUpdate(
      { _id: timerId.insertedId },
      { $set: { id: timerId.insertedId.toString() } }
    );

    console.log(`Create new timer with name: ${description},  with ID: `, newIdTimer);

    return newIdTimer;
  } catch (err) {
    console.log(`Что-то не то с новым таймером: ${err}`);
  }
};

//TODO остановка выбранного таймера
const resultStoped = async (DB, id, userId) => {
  const result = await DB.collection("timers").findOne({ _id: ObjectId(id) }, { projection: { start: 1 } });

  console.log(`START >>>>>> `, result);

  await DB.collection("timers").findOneAndUpdate(
    {
      _id: ObjectId(id),
      userId: userId,
    },
    {
      $set: {
        isActive: false,
        end: Date.now(),
        duration: Date.now() - result.start,
      },
    }
  );

  return result._id;
};

//TODO запуск web socet
server.on("upgrade", async (req, socket, head) => {
  try {
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = searchParams && searchParams.get("sessionId");
    const result = await findUserInSession(await DB(), sessionId);
    console.log(`RESULT session `, result._id);
    const userId = sessionId && result._id;

    if (!userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    req.userId = userId;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } catch (err) {
    console.log(`Ошибка в UPGRADE  подключения: `, err);
  }
});

wss.on("connection", (ws, req) => {
  const { userId } = req;

  clients.set(userId, ws);

  ws.on("close", () => {
    clients.delete(userId);
  });

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      return;
    }

    if (data.type === "all_timers") {
      (async () => {
        try {
          const result = await getAllTimers(await DB(), data.userId);
          ws.send(
            JSON.stringify({
              type: "all_timers",
              message: "Привет с сервера - all-timers",
              timers: result,
            })
          ); // отправляем данные клиенту
        } catch (err) {
          console.log(`Ошибка передачи всех таймеров: `, err);
        }
      })();
    }

    if (data.type === "new_timer") {
      (async () => {
        try {
          console.log(`CREATE NEW TIMER, description: ${data.description} `, data); // создать новый таймер
          const idTimer = await newTimer(await DB(), data.description, data.userId);
          const result = await getAllTimers(await DB(), data.userId);

          ws.send(
            JSON.stringify({
              type: "all_timers",
              message: "Привет с сервера - new-timer",
              timers: result,
              idTimer: idTimer,
            })
          ); // отправляем данные клиенту
        } catch (err) {
          console.log(`Ошибка при создании таймера: `, err);
        }
      })();
    }

    if (data.type === "stop_timer") {
      (async () => {
        try {
          console.log(`STOPED timer with ID: `, data.id);
          console.log(`USER ID: `, data.userId);

          const stopId = await resultStoped(await DB(), data.id, data.userId);
          const result = await getAllTimers(await DB(), data.userId);

          ws.send(
            JSON.stringify({
              type: "all_timers",
              message: "Привет с сервера - new-timer",
              timers: result,
              timerId: stopId,
            })
          ); // отправляем данные клиенту
        } catch (err) {
          console.log(`Ошибка остановки таймера: `, err);
        }
      })();
    }

    if (data.type === "exit_session") {
      (async () => {
        try {
          console.log(`Выход из сессии`);
          const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
          const sessionId = searchParams && searchParams.get("sessionId");

          console.log(`DELETE SESSION::: `, sessionId);
          await deleteSession(await DB(), sessionId);

          ws.on("close", () => {
            console.log(`Соединение разорвано!`);
          });
          return;
        } catch (err) {
          console.log(`Ошибка при выходе из сессии: `, err);
        }
      })();
    }
  });
});

const port = process.env.PORT;

server.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
});
