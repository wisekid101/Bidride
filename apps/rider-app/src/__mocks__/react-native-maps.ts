import React from 'react';
const MapView = (props: any) => React.createElement('MapView', props);
MapView.Animated = (props: any) => React.createElement('MapViewAnimated', props);
export default MapView;
export const Marker = (props: any) => React.createElement('Marker', props);
export const Polyline = (props: any) => React.createElement('Polyline', props);
export const PROVIDER_GOOGLE = 'google';
