import { CapabilityBoundary } from "../../../src/components/CapabilityBoundary";
import { ReceptionScreen } from "../../../src/features/reception/ReceptionScreen";

const { CAPABILITIES } = require("../../../src/navigation/accessPolicy");

export default function NewReceptionRoute() {
  return <CapabilityBoundary capability={CAPABILITIES.RECEPTION_CREATE}><ReceptionScreen /></CapabilityBoundary>;
}
