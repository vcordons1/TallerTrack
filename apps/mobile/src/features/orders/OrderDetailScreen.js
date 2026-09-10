import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing, typography } from "../../theme/tokens";
import { useSession } from "../../session/SessionProvider";
import {
  DetailSection,
  DetailTopBar,
  KeyValueRow,
  MoneySummary,
  OrderSummaryHeader,
  OrdersError,
  OrdersLoading,
  PartItem,
  TimelineItem,
  WorkItem,
} from "./OrderComponents";

const { demoOrderRepository } = require("./demoOrderRepository");
const { formatDateTime, getOrderView } = require("./orderPresentation");

export function OrderDetailScreen({ repository = demoOrderRepository }) {
  const { id } = useLocalSearchParams();
  const { access } = useSession();
  const orderView = getOrderView(access.roles);
  const orderId = Array.isArray(id) ? id[0] : id;
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    repository.loadDetail(orderId, orderView).then(
      (detail) => active && setState(detail ? { status: "success", detail } : { status: "notFound" }),
      (error) => active && setState({ status: "error", message: error?.message ?? "Ocurrió un error inesperado." }),
    );

    return () => {
      active = false;
    };
  }, [orderId, orderView, reloadKey, repository]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/interno/ordenes");
  }, []);

  if (state.status === "loading") {
    return <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}><OrdersLoading detail /></SafeAreaView>;
  }

  if (state.status === "error") {
    return (
      <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
        <OrdersError title="No pudimos cargar la orden" message={state.message} onBack={goBack} onRetry={retry} />
      </SafeAreaView>
    );
  }

  if (state.status === "notFound") {
    return (
      <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
        <OrdersError title="No se encontró la orden" message="La orden no existe o ya no tienes acceso a ella." onBack={goBack} />
      </SafeAreaView>
    );
  }

  const { orden, participantes, diagnostico, trabajos, repuestos, eventos } = state.detail;
  const activeMechanics = participantes.filter(({ retiradoEn }) => !retiradoEn);

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <DetailTopBar onBack={goBack} />
        <OrderSummaryHeader order={orden} />

        {orden.vehiculo ? (
          <DetailSection icon="car-info" title="Vehículo y recepción" description="Identidad de la atención al momento del ingreso.">
            <KeyValueRow label="Placa" value={orden.vehiculo.placa ?? "Sin placa"} />
            <KeyValueRow label="Kilometraje de ingreso" value={`${orden.kilometrajeIngreso} km`} />
            {orden.clienteContractual ? <KeyValueRow label="Cliente contractual" value={orden.clienteContractual.nombre} /> : null}
            <KeyValueRow label="Ingreso" value={formatDateTime(orden.ingresadoEn)} />
            <KeyValueRow label="Motivo" value={orden.motivoIngreso} />
            <KeyValueRow label="Recepción" value={orden.danosVisibles} last />
          </DetailSection>
        ) : null}

        {activeMechanics.length > 0 ? (
          <DetailSection icon="account-hard-hat-outline" title="Equipo asignado">
            {activeMechanics.map((participation, index) => (
              <KeyValueRow
                key={participation.id}
                label="Mecánico"
                last={index === activeMechanics.length - 1}
                value={participation.mecanico.nombre}
              />
            ))}
          </DetailSection>
        ) : null}

        {diagnostico ? (
          <DetailSection icon="stethoscope" title="Diagnóstico" description={`Informe confirmado · revisión ${diagnostico.numeroRevision}`}>
            <View style={styles.narrativeBlock}>
              <Text style={styles.narrativeLabel}>RESUMEN OPERATIVO</Text>
              <Text style={styles.narrativeText}>{diagnostico.resumenCliente}</Text>
              <Text style={styles.narrativeSupporting}>{diagnostico.detalleTecnico}</Text>
              <Text style={styles.narrativeTime}>Confirmado {formatDateTime(diagnostico.confirmadoEn)}</Text>
            </View>
          </DetailSection>
        ) : null}

        {trabajos.length > 0 ? (
          <DetailSection icon="tools" title="Trabajos" description="El estado de cada trabajo se muestra separado del estado de la orden.">
            {trabajos.map((work, index) => <WorkItem key={work.id} last={index === trabajos.length - 1} work={work} />)}
          </DetailSection>
        ) : null}

        {repuestos.length > 0 ? (
          <DetailSection icon="package-variant-closed" title="Repuestos" description="Cantidades asociadas a reservas de esta atención.">
            {repuestos.map((item, index) => <PartItem item={item} key={item.reserva.id} last={index === repuestos.length - 1} />)}
          </DetailSection>
        ) : null}

        {orden.saldo ? (
          <DetailSection icon="cash-multiple" title="Resumen económico" description="Cargos y pagos registrados; no es el total del presupuesto.">
            <MoneySummary balance={orden.saldo} />
          </DetailSection>
        ) : null}

        {eventos.length > 0 ? (
          <DetailSection icon="timeline-clock-outline" title="Actividad" description="Hechos registrados en orden cronológico.">
            <View style={styles.timeline}>
              {eventos.map((event, index) => <TimelineItem event={event} key={event.id} last={index === eventos.length - 1} />)}
            </View>
          </DetailSection>
        ) : null}

        <Text style={styles.demoNotice}>Modo demostración · consulta solamente</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { width: "100%", maxWidth: 760, alignSelf: "center", gap: spacing.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  narrativeBlock: { gap: spacing.sm, paddingVertical: spacing.lg },
  narrativeLabel: { ...typography.caption, color: colors.primary, fontWeight: "700", letterSpacing: 0.6 },
  narrativeText: { ...typography.bodyStrong, color: colors.textPrimary },
  narrativeSupporting: { ...typography.body, color: colors.textSecondary },
  narrativeTime: { ...typography.caption, color: colors.textSecondary },
  timeline: { paddingTop: spacing.lg, paddingBottom: spacing.md },
  demoNotice: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
});
