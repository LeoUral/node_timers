function creat() {
  /**
   * создайте WebSocket клиент и используйте переменные USER_ID и AUTH_TOKEN
   *  (или те, что вы выбрали для решения этой задачи) для аутентификации.
   *
   * подпишитесь на сообщения all_timers и active_timers и при их поступлении
   * обновляйте списки this.activeTimers и this.oldTimers.
   */

  const loginData = document.getElementById("login");
  const signupData = document.getElementById("signup");
  const app_block = document.getElementById("block_timers");
  const app_login = document.getElementById("app_login");
  const create_Timer = document.getElementById("create_Timer");
  // const close_arr = document.querySelectorAll(".close");

  let client = null;

  loginData.addEventListener("submit", (e) => {
    e.preventDefault();

    const username = loginData.getElementsByClassName("username")[0].value;
    const password = loginData.getElementsByClassName("password")[0].value;

    console.log(`username >>> `, username);
    console.log(`password => `, password);

    fetch("/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => {
        if (response.ok) {
          loginData.getElementsByClassName("username")[0].value = "";
          loginData.getElementsByClassName("password")[0].value = "";

          return response.json();
        } else {
          return response.text().then((err) => {
            throw new Error(err);
          });
        }
      })
      .then(({ sessionId, userId }) => {
        console.log(sessionId, userId);
        const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
        client = new WebSocket(`${wsProto}//${location.host}?sessionId=${sessionId}`);

        client.addEventListener("open", () => {
          console.log(`Соединение состоялось )))`); // test
          window.AUTH_TOKEN = sessionId;

          client.send(
            JSON.stringify({
              message: "Проверка связи!!!",
              type: "all_timers",
              userId: userId.id,
            })
          );
          app_login.style.display = "none";
          app_block.style.display = "block";

          // ввод нового таймера
          create_Timer.addEventListener("submit", (event) => {
            event.preventDefault();
            const description = create_Timer.getElementsByClassName("description")[0].value;

            console.log(`description => `, description);

            client.send(
              JSON.stringify({
                message: "NEW TIMER",
                type: "new_timer",
                description: description,
                userId: userId.id,
              })
            );
            create_Timer.getElementsByClassName("description")[0].value = "";
          });
        });
        client.addEventListener("message", (message) => {
          let data;
          try {
            data = JSON.parse(message.data);
          } catch (err) {
            console.log(`Ошибка в message: `, err);
          }

          if (data.type === "all_timers") {
            // console.log(`ALL_TIMERS `, data); // test

            personalData(data, client, userId, username, intervalStep);
            getActiveTimers(data, client, userId);
            getDisactiveTimers(data);
          }
        });

        //todo timer step = 1000
        let intervalStep = setInterval(() => {
          client.send(
            JSON.stringify({
              message: "run timers",
              type: "all_timers",
              userId: userId.id,
            })
          );
        }, 1000);
        intervalStep;
      })
      .catch((err) => {
        errorLogin();
        console.log(err);
      });
  });

  //Регистрация пользователя
  signupData.addEventListener("submit", (e) => {
    e.preventDefault();
    ``;
    const username = signupData.getElementsByClassName("username")[0].value;
    const password = signupData.getElementsByClassName("password")[0].value;

    console.log(`SIGNUP >>>> `, username, password); // test

    fetch("/signup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => {
        console.log(`RESPONSE >>> `, response); // test
        if (response.ok) {
          return response.json();
        } else {
          return response.text().then((err) => {
            throw new Error(err);
          });
        }
      })
      .then((result) => {
        console.log(`RESULT :: `, result); // test
        if (!result) {
          errorLogin();
          signupData.getElementsByClassName("username")[0].value = "";
          signupData.getElementsByClassName("password")[0].value = "";
        }
      });
  });
}

function formatDuration(d) {
  d = Math.floor(d / 1000);
  const s = d % 60;
  d = Math.floor(d / 60);
  const m = d % 60;
  const h = Math.floor(d / 60);
  return [h > 0 ? h : null, m, s]
    .filter((x) => x !== null)
    .map((x) => (x < 10 ? "0" : "") + x)
    .join(":");
}

// получение активных таймеров
function getActiveTimers(data, client, userId) {
  const isActive = document.getElementById("isactive_timers");
  let renderData = "";
  data.timers.forEach((element) => {
    if (element.isActive) {
      const progress = formatDuration(Date.now() - element.start);
      renderData =
        renderData +
        `<div><span class="close" style="cursor: pointer" data-id=${element.id} } > &#10006; </span><span> ${element.description} </span>(<span> ${progress} </span>  )</div>`;
    }
  });
  isActive.innerHTML = `<div> <b> Активные таймеры: </b> </div><div>${renderData}</div>`;

  // event отслеживание остановки таймера
  const close_arr = document.querySelectorAll(".close");
  // console.log(close_arr);
  close_arr.forEach((close) => {
    close.addEventListener("click", (e) => {
      console.log(`EVENT CLICK CLOSE:::`, e.target.dataset.id);
      e.preventDefault();

      client.send(
        JSON.stringify({
          message: "STOP TIMER",
          type: "stop_timer",
          id: e.target.dataset.id,
          userId: userId.id,
        })
      );
    });
  });
}

// получение отключенных таймеров
function getDisactiveTimers(data) {
  const disActive = document.getElementById("disactive_timers");
  let renderData = "";
  data.timers.forEach((element) => {
    if (!element.isActive) {
      const duration = formatDuration(element.duration);

      renderData =
        renderData +
        `<div><span> ${element.description} </span>(<span> работал в течении: ${duration} </span>  )</div>`;
    }
  });
  disActive.innerHTML = `<div> <b> Отключенные таймеры: </b> </div><div>${renderData}</div>`;
}

// отображение USERNAME и выход из сессии
function personalData(data, client, userId, username, intervalStep) {
  const personal = document.getElementById("persional");
  // console.log(`DATA >>>> `, data);
  personal.innerHTML = `<div> Пользватель: <b> ${username} </b> <span style="color: blue; cursor: pointer" id="exit"> Выход из сессии </span> </div>`;

  const exit = document.getElementById("exit");
  exit.addEventListener("click", () => {
    console.log(`EXIT SESSION in FRONTEND`); // test
    client.send(
      JSON.stringify({
        message: "EXIT",
        type: "exit_session",
        userId: userId.id,
      })
    );

    client.close();

    clearInterval(intervalStep);
    const app_login = document.getElementById("app_login");
    const app_block = document.getElementById("block_timers");
    app_login.style.display = "block";
    app_block.style.display = "none";
  });
}

// сообщения об ошибке при входе
function errorLogin() {
  const renderErr = document.getElementById("error_login");
  renderErr.style.display = "block";
  setTimeout(() => {
    renderErr.style.display = "none";
  }, 2000);
}

creat();
