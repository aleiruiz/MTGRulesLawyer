import QuestionConfirmationScreen from "../src/questions/QuestionConfirmationScreen";
import { StyleSheet, View } from "react-native";
import AdminReviewLink from "../src/reviews/AdminReviewLink";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <QuestionConfirmationScreen />
      <AdminReviewLink />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
