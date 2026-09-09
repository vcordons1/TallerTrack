import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";
import { useSession } from "../../src/session/SessionProvider";

export default function ClientAccountScreen() {
  const { access } = useSession();

  return (
    <PlaceholderScreen
      eyebrow="Cuenta cliente"
      title={access.nombreMostrado}
      description="Base reservada para perfil, deuda propia y acceso. La edición de perfil permanece cerrada por G-06."
    />
  );
}
