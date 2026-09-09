import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router";

import { ActorBoundary } from "../../src/components/ActorBoundary";
import { colors, typography } from "../../src/theme/tokens";

const { ACTOR_TYPES } = require("../../src/navigation/accessPolicy");

const CLIENT_TABS = Object.freeze({
  index: { title: "Atenciones", icon: "clipboard-text-outline" },
  vehiculos: { title: "Vehículos", icon: "car-outline" },
  citas: { title: "Citas", icon: "calendar-blank-outline" },
  cuenta: { title: "Cuenta", icon: "account-circle-outline" },
});

function ClientTabs() {
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerStyle: { backgroundColor: colors.surfaceElevated },
        headerShadowVisible: true,
        headerTitleStyle: { ...typography.bodyStrong },
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { ...typography.label },
        tabBarStyle: { backgroundColor: colors.surfaceElevated },
      }}
    >
      {Object.entries(CLIENT_TABS).map(([name, tab]) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons
                accessible={false}
                color={color}
                name={tab.icon}
                size={size}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

export default function ClientLayout() {
  return (
    <ActorBoundary actorType={ACTOR_TYPES.CLIENT}>
      <ClientTabs />
    </ActorBoundary>
  );
}
