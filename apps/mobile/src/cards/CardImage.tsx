import { Image } from "expo-image";
import type { StyleProp, ImageStyle } from "react-native";

// Scryfall's image CDN answers 400 to the default Android client user agent (okhttp/<version>),
// so card images are requested with the app's own User-Agent, as Scryfall's guidelines ask.
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
  return (
    <Image
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      source={{ uri, headers: SCRYFALL_HEADERS }}
      style={style}
      contentFit="contain"
      transition={150}
    />
  );
}
