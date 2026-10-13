import { Image } from "expo-image";
import { useMemo } from "react";
import { Platform, type StyleProp, type ImageStyle } from "react-native";

// Scryfall's image CDN answers 400 to the default Android client user agent (okhttp/<version>),
// so native apps request card images with the app's own User-Agent, as Scryfall's guidelines ask.
// The web build loads them as plain images: given headers, expo-image on web downloads the file
// with fetch instead, which needs CORS from the CDN and repeats on every render of the parent.
const SCRYFALL_HEADERS = {
  "User-Agent": "MTGRulesLawyer/0.1",
  Accept: "image/*",
};

interface CardImageProps {
  uri: string;
  accessibilityLabel?: string;
  style: StyleProp<ImageStyle>;
}

/** A card image from Scryfall, shown whole and unaltered. */
export default function CardImage({ uri, accessibilityLabel, style }: CardImageProps) {
  const source = useMemo(
    () => (Platform.OS === "web" ? { uri } : { uri, headers: SCRYFALL_HEADERS }),
    [uri],
  );
  return (
    <Image
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      source={source}
      style={style}
      contentFit="contain"
      transition={150}
    />
  );
}
