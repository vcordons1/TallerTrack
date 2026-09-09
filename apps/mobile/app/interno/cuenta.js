import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";
import { useSession } from "../../src/session/SessionProvider";

export default function InternalAccountScreen() {
  const { access } = useSession();

  return (
    <PlaceholderScreen
      eyebrow="Cuenta interna"
      title={access.nombreMostrado}
      description={`Roles vigentes: ${access.roles.join(", ")}. No existe cambio de rol; esta lista es informativa.`}
    />
  );
}
