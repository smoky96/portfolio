import { Modal } from "antd";

let activeFeedbackModal: ReturnType<typeof Modal.error> | null = null;

function normalizeErrorMessage(input: unknown, fallbackMessage: string): string {
  const raw = input instanceof Error ? input.message : typeof input === "string" ? input : String(input ?? "");
  const cleaned = raw.replace(/^Error:\s*/i, "").trim();
  return cleaned || fallbackMessage;
}

interface ErrorModalOptions {
  title?: string;
  fallbackMessage?: string;
}

interface SuccessModalOptions {
  title?: string;
  fallbackMessage?: string;
}

function openFeedbackModal(
  factory: typeof Modal.error,
  payload: { title: string; content: string }
) {
  if (activeFeedbackModal) {
    activeFeedbackModal.destroy();
  }

  activeFeedbackModal = factory({
    title: payload.title,
    content: payload.content,
    okText: "确定",
    centered: true,
    onOk: () => {
      activeFeedbackModal = null;
    },
    onCancel: () => {
      activeFeedbackModal = null;
    }
  });
}

export function showErrorModal(error: unknown, options?: ErrorModalOptions) {
  openFeedbackModal(Modal.error, {
    title: options?.title ?? "请求失败",
    content: normalizeErrorMessage(error, options?.fallbackMessage ?? "请稍后重试")
  });
}

export function showSuccessModal(message: unknown, options?: SuccessModalOptions) {
  openFeedbackModal(Modal.success, {
    title: options?.title ?? "操作成功",
    content: normalizeErrorMessage(message, options?.fallbackMessage ?? "操作已完成")
  });
}
