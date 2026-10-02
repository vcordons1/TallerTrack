import { Stack } from "expo-router";
import { CustomerVehicleBoundary } from "../../../../src/features/customers-vehicles/CustomerVehicleComponents";
export default function VehiclesLayout() {
  return <CustomerVehicleBoundary><Stack><Stack.Screen name="index" options={{ title: "Vehículos", headerShown: false }} />
    <Stack.Screen name="nuevo" options={{ title: "Registrar vehículo" }} />
    <Stack.Screen name="[id]" options={{ title: "Vehículo" }} />
    <Stack.Screen name="transferir/[id]" options={{ title: "Transferir propietario" }} /></Stack></CustomerVehicleBoundary>;
}
