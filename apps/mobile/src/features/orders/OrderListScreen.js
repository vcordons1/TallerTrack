import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProductHeader } from "../../components/ProductHeader";
import { useSession } from "../../session/SessionProvider";
import { colors, radii, spacing, typography } from "../../theme/tokens";
import {
  FilterChip,
  OrderListItem,
  OrdersEmpty,
  OrdersError,
  OrdersLoading,
} from "./OrderComponents";

const { demoOrderRepository } = require("./demoOrderRepository");
const {
  FILTER_OPTIONS,
  ORDER_FILTERS,
  filterOrders,
  getOrderDetailRoute,
  getOrderView,
  normalizeOrderFilter,
} = require("./orderPresentation");

export function OrderListScreen({ repository = demoOrderRepository, realReception = false, realTechnical = false }) {
  const params = useLocalSearchParams();
  const { access } = useSession();
  const orderView = realTechnical ? "TECNICA" : getOrderView(access.roles);
  const realOrders = realReception || realTechnical;
  const [filter, setFilter] = useState(() => normalizeOrderFilter(params.filtro));
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState({ status: "loading" });
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const firstFocus = useRef(true);

  useFocusEffect(useCallback(() => {
    if (!realOrders) return;
    if (firstFocus.current) firstFocus.current = false;
    else setReloadKey((value) => value + 1);
  }, [realOrders]));

  useEffect(() => {
    setFilter(normalizeOrderFilter(params.filtro));
  }, [params.filtro]);

  useEffect(() => {
    let active = true;
    if (!refreshing) setState({ status: "loading" });

    const load = realOrders ? repository.loadPage(orderView) : repository.loadList(orderView).then((orders) => ({ orders, cursor: null }));
    load.then(
      ({ orders, cursor }) => {
        if (active) {
          setState({ status: "success", orders });
          setNextCursor(cursor);
          setPageError(false);
          setRefreshing(false);
        }
      },
      (error) => {
        if (active) {
          setState({ status: "error", message: error?.message ?? "Ocurrió un error inesperado." });
          setRefreshing(false);
        }
      },
    );

    return () => {
      active = false;
    };
  }, [orderView, reloadKey, repository, realOrders]);

  const visibleOrders = useMemo(
    () => filterOrders(state.status === "success" ? state.orders : [], filter),
    [filter, state],
  );
  const retry = useCallback(() => setReloadKey((value) => value + 1), []);
  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((value) => value + 1);
  }, []);
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || state.status !== "success") return;
    setLoadingMore(true);
    try {
      const page = await repository.loadPage(orderView, nextCursor);
      setState((current) => current.status === "success"
        ? { status: "success", orders: [...current.orders, ...page.orders] } : current);
      setNextCursor(page.cursor);
      setPageError(false);
    } catch { setPageError(true); }
    finally { setLoadingMore(false); }
  }, [nextCursor, loadingMore, state.status, repository, orderView]);

  if (state.status === "loading") {
    return <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}><OrdersLoading /></SafeAreaView>;
  }

  if (state.status === "error") {
    return (
      <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
        <OrdersError title="No pudimos cargar las órdenes" message={state.message} onRetry={retry} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
      <FlatList
        contentContainerStyle={[styles.content, visibleOrders.length === 0 && styles.emptyContent]}
        data={visibleOrders}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyExtractor={(order) => order.id}
        ListEmptyComponent={<OrdersEmpty filtered={filter !== ORDER_FILTERS.ALL} />}
        ListFooterComponent={realOrders ? nextCursor ? <Pressable accessibilityRole="button"
          disabled={loadingMore} onPress={loadMore} style={{ minHeight: 52, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ ...typography.bodyStrong, color: colors.primary }}>{loadingMore ? "Cargando…" : pageError ? "Error al cargar. Reintentar" : "Cargar más órdenes"}</Text>
        </Pressable> : null : <Text style={styles.demoNotice}>Modo demostración · consulta solamente</Text>}
        ListHeaderComponent={(
          <View style={styles.headerContent}>
            <ProductHeader context="Supervisión de atenciones" title="Órdenes" />
            {realReception ? <Pressable accessibilityRole="button" onPress={() => router.push("/interno/ordenes/nueva")}
              style={{ minHeight: 52, justifyContent: "center", alignItems: "center", borderRadius: radii.md, backgroundColor: colors.primary }}>
              <Text style={{ ...typography.bodyStrong, color: colors.onPrimary }}>Nueva recepción</Text>
            </Pressable> : null}
            <View accessible accessibilityLabel={`${visibleOrders.length} órdenes en la vista actual`} style={styles.queueSummary}>
              <View style={styles.queueIcon}>
                <MaterialCommunityIcons accessible={false} color={colors.primary} name="clipboard-text-outline" size={24} />
              </View>
              <View style={styles.queueCopy}>
                <Text style={styles.queueValue}>{visibleOrders.length}</Text>
                <Text style={styles.queueLabel}>en esta vista</Text>
              </View>
              <Text style={styles.queueSupporting}>Identifica estado y atención antes de abrir el detalle.</Text>
            </View>
            <View style={styles.filterSection}>
              <Text accessibilityRole="header" style={styles.filterTitle}>Vista de la cola</Text>
              <View accessibilityLabel="Filtros de órdenes" style={styles.filters}>
                {FILTER_OPTIONS.map((option) => (
                  <FilterChip
                    key={option.value}
                    label={option.label}
                    onPress={() => setFilter(option.value)}
                    selected={filter === option.value}
                  />
                ))}
              </View>
            </View>
          </View>
        )}
        refreshControl={<RefreshControl colors={[colors.primary]} onRefresh={refresh} refreshing={refreshing} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <OrderListItem order={item} onPress={() => router.push(getOrderDetailRoute(item.id))} />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  emptyContent: { flexGrow: 1 },
  headerContent: { gap: spacing.xl, paddingBottom: spacing.xl },
  queueSummary: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface },
  queueIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.primarySurface },
  queueCopy: { gap: 0 },
  queueValue: { ...typography.metric, color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  queueLabel: { ...typography.caption, color: colors.textSecondary },
  queueSupporting: { ...typography.supporting, minWidth: 190, flex: 1, color: colors.textSecondary },
  filterSection: { gap: spacing.md },
  filterTitle: { ...typography.title2, color: colors.textPrimary },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  separator: { height: spacing.md },
  demoNotice: { ...typography.caption, marginTop: spacing.xl, color: colors.textSecondary, textAlign: "center" },
});
