import React from "react";
import ReactDOM from "react-dom/client";
import zhCN from "antd/locale/zh_CN";
import { App as AntdApp, ConfigProvider } from "antd";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "antd/dist/reset.css";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 10,
          fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
        }
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
);
