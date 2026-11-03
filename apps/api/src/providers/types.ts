// Provider abstraction (PROVIDER_ARCHITECTURE.md §2) with the demo provider
// as the milestone's only functioning adapter. Real adapters (OpenSky, AirLabs,
// AeroDataBox, ...) land behind the same interface when credentials exist.
export { DEMO_PROVIDER_ID } from '@gfloge/shared'

export const DEMO_MAX_POSITION_AGE = 5 * 60 // fresh window for demo samples, in minutes

export type ProviderCapability = 'schedule' | 'livePositions' | 'airframeInfo' | 'historical'
