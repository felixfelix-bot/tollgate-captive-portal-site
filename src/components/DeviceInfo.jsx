// external
import { useTranslation, Trans } from 'react-i18next';

// main component for displaying device info in the portal footer
export const DeviceInfo = (props) => {
  const { net4satsDetails } = props;
  const { t: i18n } = useTranslation();

  // set default values for device type and value
  let type = 'unkonw_type';
  let value = 'unknown_value';

  // extract device type and value from net4satsDetails if available
  if (net4satsDetails.deviceInfo) {
    if (net4satsDetails.deviceInfo.type) {
      if ('mac' === net4satsDetails.deviceInfo.type) {
        type = i18n(`device_${net4satsDetails.deviceInfo.type}`);
      }
    }
    if (net4satsDetails.deviceInfo.value) {
      value = net4satsDetails.deviceInfo.value;
    }
  }

  // render a paragraph with the device type and value
  return <p className="net4sats-captive-portal-deviceinfo">
    {/* shows the device type and value, e.g. mac address, for the user */}
    {type}: {value}
  </p>;
}

export default DeviceInfo