import { Platform } from "react-native";

const localApiUrl = Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";

export const apiUrl = (process.env.EXPO_PUBLIC_API_URL || localApiUrl).replace(/\/$/, "");
