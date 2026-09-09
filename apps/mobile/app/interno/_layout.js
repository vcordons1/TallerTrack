import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router";

import { AccountHeaderAction } from "../../src/components/AccountHeaderAction";
import { ActorBoundary } from "../../src/components/ActorBoundary";
import { useSession } from "../../src/session/SessionProvider";
import { colors, typography } from "../../src/theme/tokens";

const {
  ACTOR_TYPES,
  INTERNAL_DESTINATIONS,
  getInternalDestinations,
} = require("../../src/navigation/accessPolicy");

function TabIcon({ color, size, name }) {
  return (
    <MaterialCommunityIcons
      accessible={false}
      color={color}
      name={name}
      size={size}
    />
  );
}

function InternalTabs() {
  const { access } = useSession();
  const visibleKeys = new Set(
    getInternalDestinations(access.roles).map(({ key }) => key),
  );

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerStyle: { backgroundColor: colors.surfaceElevated },
        headerShadowVisible: true,
        headerTitleStyle: { ...typography.bodyStrong },
        headerRight: () => <AccountHeaderAction href="/interno/cuenta" />,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { ...typography.label },
        tabBarStyle: { backgroundColor: colors.surfaceElevated },
      }}
    >
      {INTERNAL_DESTINATIONS.map((destination) => (
        <Tabs.Screen
          key={destination.key}
          name={destination.segment}
          options={{
            title: destination.title,
            href: visibleKeys.has(destination.key) ? undefined : null,
            tabBarAccessibilityLabel: destination.title,
            tabBarIcon: (props) => (
              <TabIcon {...props} name={destination.icon} />
            ),
          }}
        />
      ))}
      <Tabs.Screen
        name="cuenta"
        options={{
          href: null,
          title: "Cuenta y sesión",
          headerRight: () => null,
        }}
      />
    </Tabs>
  );
}

export default function InternalLayout() {
  return (
    <ActorBoundary actorType={ACTOR_TYPES.INTERNAL}>
      <InternalTabs />
    </ActorBoundary>
  );
}
