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
          colorPrimary: "#1456c7",
          colorSuccess: "#1f9d78",
          colorWarning: "#c77722",
          colorError: "#c94a4a",
          borderRadius: 12,
          borderRadiusLG: 16,
          fontFamily: "\"Noto Sans SC\", \"Source Han Sans SC\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif",
          fontSize: 14
        },
        components: {
          Layout: {
            headerBg: "#ffffffd9",
            bodyBg: "#eff3f8"
          },
          Card: {
            headerFontSize: 15,
            headerHeight: 54,
            bodyPadding: 18
          },
          Table: {
            headerBg: "#f2f6fd",
            rowHoverBg: "#f7faff"
          },
          Button: {
            fontWeight: 600,
            controlHeight: 36
          },
          Input: {
            controlHeight: 38
          },
          Select: {
            controlHeight: 38
          },
          Segmented: {
            itemSelectedBg: "#ffffff",
            itemHoverBg: "#edf2fb"
          }
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
