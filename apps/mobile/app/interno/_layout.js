import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";

import { ActorBoundary } from "../../src/components/ActorBoundary";
import { useSession } from "../../src/session/SessionProvider";
import { colors, radii, spacing, typography } from "../../src/theme/tokens";

const {
  ACTOR_TYPES,
  INTERNAL_DESTINATIONS,
  getInternalDestinations,
} = require("../../src/navigation/accessPolicy");

function TabIcon({ color, focused, name }) {
  return (
    <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
      <MaterialCommunityIcons
        accessible={false}
        color={color}
        name={name}
        size={24}
      />
    </View>
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
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: styles.tabItem,
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: styles.tabBar,
      }}
    >
      {INTERNAL_DESTINATIONS.map((destination) => (
        <Tabs.Screen
          key={destination.key}
          name={destination.segment}
          options={{
            title: destination.title,
            href: visibleKeys.has(destination.key) ? undefined : null,
            headerShown: false,
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

const styles = StyleSheet.create({
  tabBar: {
    minHeight: 74,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: 0,
    backgroundColor: colors.surfaceElevated,
    elevation: 14,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
  },
  tabItem: {
    minHeight: 58,
    borderRadius: radii.md,
  },
  tabIcon: {
    minWidth: 52,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
  tabIconActive: {
    backgroundColor: colors.primarySurface,
  },
  tabLabel: {
    ...typography.caption,
    marginTop: 2,
  },
});

export default function InternalLayout() {
  return (
    <ActorBoundary actorType={ACTOR_TYPES.INTERNAL}>
      <InternalTabs />
    </ActorBoundary>
  );
}
