import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";
import { useSession } from "../../src/session/SessionProvider";

export default function ClientServiceOrdersScreen() {
  const { access } = useSession();

  return (
    <PlaceholderScreen
      eyebrow="Espacio cliente"
      title={`Hola, ${access.nombreMostrado}`}
      description="Base reservada para atenciones propias, sin compartir navegación ni datos del espacio interno."
    />
  );
}
