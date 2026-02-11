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
          colorPrimary: "#1f4f94",
          colorSuccess: "#15936f",
          colorWarning: "#c17620",
          colorError: "#d44545",
          borderRadius: 10,
          borderRadiusLG: 18,
          fontFamily: "\"Manrope\", \"Noto Sans SC\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif",
          fontSize: 14
        },
        components: {
          Layout: {
            headerBg: "#ffffffd9",
            bodyBg: "#f1f4f9"
          },
          Card: {
            headerFontSize: 15,
            headerHeight: 54,
            bodyPadding: 18,
            colorBorderSecondary: "#d4e0ef"
          },
          Table: {
            headerBg: "#f2f6fd",
            rowHoverBg: "#f7fbff",
            borderColor: "#d8e3f2"
          },
          Button: {
            fontWeight: 600,
            controlHeight: 38
          },
          Input: {
            controlHeight: 40
          },
          Select: {
            controlHeight: 40
          },
          Segmented: {
            itemSelectedBg: "#ffffff",
            itemHoverBg: "#edf2fb"
          },
          Checkbox: {
            colorPrimary: "#1f4f94",
            colorPrimaryHover: "#2a5ca8"
          },
          Progress: {
            defaultColor: "#1f4f94",
            remainingColor: "#e7eef9"
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
