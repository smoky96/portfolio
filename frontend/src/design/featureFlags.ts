const rawUiV2Flag = import.meta.env.VITE_UI_V2;
export const UI_V2_ENABLED = rawUiV2Flag ? rawUiV2Flag === "true" : true;
export const UI_VERSION = UI_V2_ENABLED ? "v2" : "v1";
