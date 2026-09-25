import { Redirect } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { SessionLoading } from "../src/components/SessionLoading";
import { useSession } from "../src/session/SessionProvider";

const { getAuthenticatedRoot } = require("../src/navigation/accessPolicy");
const { SESSION_STATUS } = require("../src/session/sessionState");

export default function RootIndex() {
  const session = useSession();

  if (session.status === SESSION_STATUS.LOADING) {
    return <SessionLoading />;
  }

  if (session.status === SESSION_STATUS.ERROR) {
    return <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text>No se pudo verificar la sesión. Comprueba la conexión con la laptop.</Text>
      <Pressable accessibilityRole="button" onPress={session.retrySession} style={{ padding: 16 }}>
        <Text>Reintentar</Text>
      </Pressable>
    </View>;
  }

  return <Redirect href={getAuthenticatedRoot(session.access)} />;
}
