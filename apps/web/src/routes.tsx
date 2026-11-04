import { Route, Routes } from 'react-router'
import { AppShell } from './components/AppShell'
import { RequireAuth } from './components/RequireAuth'
import { BoardPage } from './pages/BoardPage'
import { LogbookPage } from './pages/LogbookPage'
import { ImportPage } from './pages/ImportPage'
import { ExplorePage } from './pages/ExplorePage'
import { StatsPage } from './pages/StatsPage'
import { SettingsPage } from './pages/SettingsPage'
import { AddFlightPage } from './pages/AddFlightPage'
import { FlightDetailPage } from './pages/FlightDetailPage'
import { MorePage } from './pages/MorePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SignInPage } from './pages/SignInPage'
import { ShareFlightPage } from './pages/ShareFlightPage'
import { ShareTripPage } from './pages/ShareTripPage'
import { SetupPage } from './pages/SetupPage'
import { TripsPage } from './pages/TripsPage'
import { TravelRiskPage } from './pages/TravelRiskPage'
import { AirportDetailPage } from './pages/AirportDetailPage'
import { AircraftProfilePage } from './pages/AircraftProfilePage'
import { AircraftTypePage } from './pages/AircraftTypePage'
import { AirlineDetailPage } from './pages/AirlineDetailPage'

export function Router() {
  return (
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/share/flight/:token" element={<ShareFlightPage />} />
      <Route path="/share/trip/:token" element={<ShareTripPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<BoardPage />} />
        <Route path="logbook" element={<LogbookPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="explore" element={<ExplorePage />} />
        <Route path="explore/airports/:airportId" element={<AirportDetailPage />} />
        <Route path="explore/airlines/:airlineId" element={<AirlineDetailPage />} />
        <Route path="aircraft/:registration" element={<AircraftProfilePage />} />
        <Route path="aircraft-type/:icao" element={<AircraftTypePage />} />
        <Route path="trips" element={<TripsPage />} />
        <Route path="trips/:tripId" element={<TripsPage />} />
        <Route path="travel-risk" element={<TravelRiskPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="add" element={<AddFlightPage />} />
        <Route path="flight/:flightId" element={<FlightDetailPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
