import { Stack } from "expo-router";
import { CustomerVehicleBoundary } from "../../../../src/features/customers-vehicles/CustomerVehicleComponents";
export default function CustomersLayout() {
  return <CustomerVehicleBoundary><Stack><Stack.Screen name="index" options={{ title: "Clientes", headerShown: false }} />
    <Stack.Screen name="nuevo" options={{ title: "Registrar cliente" }} />
    <Stack.Screen name="[id]" options={{ title: "Cliente" }} /></Stack></CustomerVehicleBoundary>;
}
