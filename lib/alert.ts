import { Alert as NativeAlert, Platform } from "react-native";

// Alert.alert works on phones, but does nothing on the web / desktop version.
// This one has the same API and uses the browser's own dialogs there instead.
type Button = { text?: string; style?: "cancel" | "destructive" | "default"; onPress?: () => void };

function webAlert(title: string, message?: string, buttons?: Button[]) {
  const text = message ? `${title}\n\n${message}` : title;
  const list = buttons ?? [];
  const cancel = list.find((b) => b.style === "cancel");
  const actions = list.filter((b) => b.style !== "cancel" && b.onPress);

  // Just a message
  if (actions.length === 0) {
    window.alert(text);
    return;
  }
  // One choice: OK / Cancel. Several choices: ask one after another (the desktop app has no prompt box).
  for (const action of actions) {
    const question = actions.length === 1 ? `${text}\n\nOK = ${action.text}` : `${text}\n\n${action.text}?`;
    if (window.confirm(question)) {
      action.onPress?.();
      return;
    }
  }
  cancel?.onPress?.();
}

export const Alert: { alert: (title: string, message?: string, buttons?: Button[]) => void } =
  Platform.OS === "web" ? { alert: webAlert } : NativeAlert;
