import { Platform, useWindowDimensions } from "react-native";

// On a big computer window the app shows the menu as a sidebar and uses more of the width.
// Phones (and narrow windows) keep the normal phone layout.
export const WIDE_FROM = 960; // window width where the sidebar appears
export const CONTENT_MAX = 1080; // the content never gets wider than this, so lines stay readable

export function useWide() {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && width >= WIDE_FROM;
}
