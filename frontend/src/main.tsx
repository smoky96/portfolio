import React from "react";
import ReactDOM from "react-dom/client";
import zhCN from "antd/locale/zh_CN";
import { App as AntdApp, ConfigProvider } from "antd";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { createAntdTheme } from "./design/antdTheme";
import { UI_V2_ENABLED, UI_VERSION } from "./design/featureFlags";
import "antd/dist/reset.css";

async function loadUiStyles() {
  if (UI_V2_ENABLED) {
    await import("./styles/app.css");
    return;
  }
  await import("./styles/legacy.css");
}

async function bootstrap() {
  await loadUiStyles();
  if (document.body) {
    document.body.dataset.uiVersion = UI_VERSION;
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ConfigProvider locale={zhCN} theme={createAntdTheme()}>
        <AntdApp>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AntdApp>
      </ConfigProvider>
    </React.StrictMode>
  );
}

void bootstrap();
