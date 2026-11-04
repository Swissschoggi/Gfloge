// Canonical database schema. Follows docs/architecture/DATA_MODEL.md.
// All timestamps are UTC timestamptz; geo is WGS84 degrees.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  smallint,
  doublePrecision,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'

export const userRole = pgEnum('user_role', ['admin', 'user'])
export const displayUnits = pgEnum('display_units', ['km', 'mi'])
export const tzDisplayPref = pgEnum('tz_display', ['airport', 'local', 'utc'])
export const themePref = pgEnum('theme_pref', ['system', 'day', 'night'])
export const flightStatus = pgEnum('flight_status', [
  'scheduled',
  'boarding',
  'enroute',
  'arrived',
  'cancelled',
  'diverted',
  'unknown',
])
export const userFlightRole = pgEnum('user_flight_role', ['tracked', 'logged'])
export const loggedState = pgEnum('logged_state', ['flown', 'planned'])
export const cabinClass = pgEnum('cabin_class', ['none', 'eco', 'premium', 'business', 'first'])
export const userFlightSource = pgEnum('user_flight_source', ['manual', 'tracked-auto', 'import'])
export const providerSource = pgEnum('provider_source', ['instance', 'env'])
export const alertType = pgEnum('alert_type', [
  'time_shift',
  'gate_change',
  'cancel',
  'divert',
  'status_change',
])

// ===== Identity and access =====

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(), // stored lowercase; login identity
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: userRole('role').notNull().default('user'),
    units: displayUnits('units').notNull().default('km'),
    timezoneDisplay: tzDisplayPref('timezone_display').notNull().default('airport'),
    themeOverride: themePref('theme_override'),
    notificationPrefs: jsonb('notification_prefs').notNull().default({ delays: true, gates: true, cancellations: true }),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)]
)

// Personal itinerary containers. A trip never changes canonical flight data.
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    startDate: timestamp('start_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('trips_user_idx').on(t.userId, t.startDate)]
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
  },
  (t) => [uniqueIndex('sessions_token_key').on(t.tokenHash), index('sessions_user_idx').on(t.userId)]
)

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  subject: text('subject'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const instanceSettings = pgTable('instance_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
})

// ===== Reference data (instance shared) =====

export const airports = pgTable(
  'airports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    iata: text('iata'),
    icao: text('icao'),
    name: text('name').notNull(),
    city: text('city').notNull(),
    country: text('country').notNull(), // ISO-2
    region: text('region'),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    elevationFt: integer('elevation_ft'),
    tz: text('tz'), // IANA; null when unknown (never assume UTC)
    source: text('source').notNull().default('seed'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('airports_iata_key').on(t.iata), index('airports_icao_idx').on(t.icao)]
)

export const airlines = pgTable(
  'airlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    iata: text('iata'),
    icao: text('icao'),
    name: text('name').notNull(),
    commonName: text('common_name'),
    callsign: text('callsign'),
    country: text('country'),
    active: boolean('active').notNull().default(true),
    source: text('source').notNull().default('seed'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('airlines_iata_key').on(t.iata), index('airlines_icao_idx').on(t.icao)]
)

export const aircraftTypes = pgTable(
  'aircraft_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    iataType: text('iata_type'),
    icaoType: text('icao_type'),
    manufacturer: text('manufacturer').notNull(),
    name: text('name').notNull(),
    family: text('family'),
    source: text('source').notNull().default('seed'),
  },
  (t) => [index('aircraft_types_icao_idx').on(t.icaoType)]
)

export const aircraft = pgTable(
  'aircraft',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registration: text('registration').notNull(),
    hexIcao: text('hex_icao'),
    aircraftTypeId: uuid('aircraft_type_id').references(() => aircraftTypes.id),
    source: text('source').notNull().default('seed'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('aircraft_registration_key').on(t.registration)]
)

// ===== Canonical flights (instance shared) =====

export const flights = pgTable(
  'flights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    airlineId: uuid('airline_id').references(() => airlines.id),
    flightCode: text('flight_code').notNull(),
    departureAirportId: uuid('departure_airport_id')
      .notNull()
      .references(() => airports.id),
    arrivalAirportId: uuid('arrival_airport_id')
      .notNull()
      .references(() => airports.id),
    // UTC date of scheduled departure; identity component for dedup.
    depDateKey: text('dep_date_key').notNull(),
    scheduledDeparture: timestamp('scheduled_departure', { withTimezone: true }).notNull(),
    scheduledArrival: timestamp('scheduled_arrival', { withTimezone: true }).notNull(),
    status: flightStatus('status').notNull().default('scheduled'),
    actualDeparture: timestamp('actual_departure', { withTimezone: true }),
    actualArrival: timestamp('actual_arrival', { withTimezone: true }),
    depTerminal: text('dep_terminal'),
    depGate: text('dep_gate'),
    arrTerminal: text('arr_terminal'),
    arrGate: text('arr_gate'),
    arrBaggage: text('arr_baggage'),
    aircraftRegistration: text('aircraft_registration'),
    aircraftTypeId: uuid('aircraft_type_id').references(() => aircraftTypes.id),
    distanceKm: integer('distance_km'),
    providerRefs: jsonb('provider_refs'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('flights_identity_key').on(
      t.airlineId,
      t.flightCode,
      t.depDateKey,
      t.departureAirportId,
      t.arrivalAirportId
    ),
    index('flights_sched_dep_idx').on(t.scheduledDeparture),
    index('flights_code_date_idx').on(t.flightCode, t.depDateKey),
  ]
)

export const positions = pgTable(
  'positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flightId: uuid('flight_id')
      .notNull()
      .references(() => flights.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    altFt: integer('alt_ft'),
    groundSpeedKt: integer('ground_speed_kt'),
    headingDeg: doublePrecision('heading_deg'),
    verticalRate: doublePrecision('vertical_rate'),
    onGround: boolean('on_ground'),
    source: text('source').notNull(),
  },
  (t) => [index('positions_flight_ts_idx').on(t.flightId, t.ts)]
)

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flightId: uuid('flight_id')
      .notNull()
      .references(() => flights.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // null = flight-level fact
    type: alertType('type').notNull(),
    old: jsonb('old'),
    new: jsonb('new'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [index('alerts_flight_idx').on(t.flightId)]
)

// ===== User owned data (private per user) =====

export const userFlights = pgTable(
  'user_flights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    flightId: uuid('flight_id').references(() => flights.id, { onDelete: 'cascade' }),
    manualFlightId: uuid('manual_flight_id'), // added: links self-entered records (see DATA_MODEL 2.4)
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    role: userFlightRole('role').notNull(),
    loggedState: loggedState('logged_state'),
    trackedFrom: timestamp('tracked_from', { withTimezone: true }),
    trackedUntil: timestamp('tracked_until', { withTimezone: true }),
    seat: text('seat'),
    cabin: cabinClass('cabin').notNull().default('none'),
    note: text('note'),
    rating: smallint('rating'),
    source: userFlightSource('source').notNull().default('manual'),
    importBatchId: uuid('import_batch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_flights_one_record_key').on(t.userId, t.flightId, t.manualFlightId),
    index('user_flights_user_idx').on(t.userId, t.role),
  ]
)

export const flightRecordSource = pgEnum('flight_record_source', ['manual', 'imported', 'observed', 'scheduled'])

export const manualFlights = pgTable(
  'manual_flights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    airlineId: uuid('airline_id').references(() => airlines.id),
    flightNumber: text('flight_number'),
    departureAirportId: uuid('departure_airport_id')
      .notNull()
      .references(() => airports.id),
    arrivalAirportId: uuid('arrival_airport_id')
      .notNull()
      .references(() => airports.id),
    scheduledDeparture: timestamp('scheduled_departure', { withTimezone: true }).notNull(),
    scheduledArrival: timestamp('scheduled_arrival', { withTimezone: true }),
    actualDeparture: timestamp('actual_departure', { withTimezone: true }),
    actualArrival: timestamp('actual_arrival', { withTimezone: true }),
    depTerminal: text('dep_terminal'),
    depGate: text('dep_gate'),
    arrTerminal: text('arr_terminal'),
    arrGate: text('arr_gate'),
    scheduledGateDeparture: timestamp('scheduled_gate_departure', { withTimezone: true }),
    actualGateDeparture: timestamp('actual_gate_departure', { withTimezone: true }),
    scheduledTakeoff: timestamp('scheduled_takeoff', { withTimezone: true }),
    actualTakeoff: timestamp('actual_takeoff', { withTimezone: true }),
    scheduledLanding: timestamp('scheduled_landing', { withTimezone: true }),
    actualLanding: timestamp('actual_landing', { withTimezone: true }),
    scheduledGateArrival: timestamp('scheduled_gate_arrival', { withTimezone: true }),
    actualGateArrival: timestamp('actual_gate_arrival', { withTimezone: true }),
    cancelled: boolean('cancelled').notNull().default(false),
    divertedToAirportId: uuid('diverted_to_airport_id').references(() => airports.id),
    depDateKey: text('dep_date_key').notNull(),
    aircraftTypeId: uuid('aircraft_type_id').references(() => aircraftTypes.id),
    aircraftRegistration: text('aircraft_registration'),
    seat: text('seat'),
    seatType: text('seat_type'),
    cabin: cabinClass('cabin').notNull().default('none'),
    bookingReference: text('booking_reference'),
    flightReason: text('flight_reason'),
    note: text('note'),
    rating: smallint('rating'),
    sourceType: flightRecordSource('source_type').notNull().default('manual'),
    sourceName: text('source_name'),
    sourceRecordId: text('source_record_id'),
    sourceMetadata: jsonb('source_metadata'),
    fieldSources: jsonb('field_sources'),
    importBatchId: uuid('import_batch_id'),
    importedAt: timestamp('imported_at', { withTimezone: true }),
    distanceKm: integer('distance_km'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('manual_flights_user_idx').on(t.userId), index('manual_flights_source_idx').on(t.userId, t.sourceType, t.sourceName)]
)

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceFormat: text('source_format').notNull(),
    fileName: text('file_name'),
    totalRows: integer('total_rows').notNull().default(0),
    importedCount: integer('imported_count').notNull().default(0),
    enrichedCount: integer('enriched_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('import_batches_user_idx').on(t.userId, t.createdAt)]
)

// ===== Provider infrastructure =====

export const providerCache = pgTable('provider_cache', {
  key: text('key').primaryKey(),
  payload: jsonb('payload').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  ttlSeconds: integer('ttl_seconds').notNull(),
  hits: integer('hits').notNull().default(0),
})

export const providerState = pgTable('provider_state', {
  providerId: text('provider_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  quotaUsed: integer('quota_used'),
  quotaResetsAt: timestamp('quota_resets_at', { withTimezone: true }),
})

// Optional historical datasets: metadata only, large files stay on disk.
export const historicalDatasets = pgTable(
  'historical_datasets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    datasetKey: text('dataset_key').notNull(),
    title: text('title').notNull(),
    releaseTag: text('release_tag').notNull(),
    assetName: text('asset_name').notNull(),
    downloadUrl: text('download_url').notNull(),
    sizeBytes: integer('size_bytes'),
    sha256: text('sha256'),
    dateStart: text('date_start').notNull(),
    dateEnd: text('date_end').notNull(),
    license: text('license').notNull(),
    attribution: text('attribution').notNull(),
    status: text('status').notNull().default('available'),
    progressBytes: integer('progress_bytes').notNull().default(0),
    error: text('error'),
    localPath: text('local_path'),
    installedAt: timestamp('installed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('historical_datasets_key').on(t.source, t.datasetKey)]
)

export const providerCredentials = pgTable('provider_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: text('provider_id').notNull(),
  configEncrypted: text('config_encrypted').notNull(), // AES-256-GCM, key derived from GF_SECRET
  maskedHint: text('masked_hint').notNull(),
  source: providerSource('source').notNull().default('instance'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('provider_credentials_provider_id_key').on(t.providerId)])

// ===== Logbook batch infrastructure =====

export const imports = pgTable('imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  summary: text('summary'),
  importedCount: integer('imported_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ===== Reference data (instance-wide, downloadable) =====

export const referenceDatasets = pgTable('reference_datasets', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(), // airports | airlines | aircraft_types | countries
  name: text('name').notNull(),
  description: text('description').notNull(),
  source: text('source').notNull(),
  sourceUrl: text('source_url').notNull(),
  license: text('license').notNull(),
  attribution: text('attribution').notNull(),
  version: text('version'),
  checksum: text('checksum'),
  sizeBytes: integer('size_bytes'),
  recordCount: integer('record_count'),
  status: text('status').notNull().default('not_installed'), // not_installed | downloading | verifying | installed | failed
  progressBytes: integer('progress_bytes').notNull().default(0),
  error: text('error'),
  localPath: text('local_path'),
  installedAt: timestamp('installed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const refAirports = pgTable('ref_airports', {
  id: uuid('id').primaryKey().defaultRandom(),
  icao: text('icao').notNull().unique(),
  iata: text('iata'),
  name: text('name').notNull(),
  city: text('city'),
  country: text('country'),
  countryCode: text('country_code'),
  lat: doublePrecision('lat'),
  lon: doublePrecision('lon'),
  tz: text('tz'),
  active: boolean('active').notNull().default(true),
  source: text('source').notNull().default('reference'),
}, (t) => [index('ref_airports_iata').on(t.iata)])

export const refAirlines = pgTable('ref_airlines', {
  id: uuid('id').primaryKey().defaultRandom(),
  iata: text('iata'),
  icao: text('icao'),
  name: text('name').notNull(),
  callsign: text('callsign'),
  country: text('country'),
  active: boolean('active').notNull().default(true),
  source: text('source').notNull().default('reference'),
}, (t) => [index('ref_airlines_iata').on(t.iata), index('ref_airlines_icao').on(t.icao)])

export const refAircraftTypes = pgTable('ref_aircraft_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  icaoType: text('icao_type').notNull().unique(),
  iataType: text('iata_type'),
  manufacturer: text('manufacturer'),
  name: text('name').notNull(),
  category: text('category'),
  wake: text('wake'),
  source: text('source').notNull().default('reference'),
})

export const refCountries = pgTable('ref_countries', {
  id: uuid('id').primaryKey().defaultRandom(),
  alpha2: text('alpha2').notNull().unique(),
  alpha3: text('alpha3'),
  name: text('name').notNull(),
})


export const shareResourceType = pgEnum('share_resource_type', ['flight', 'trip'])

export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    resourceType: shareResourceType('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('share_links_token_key').on(t.tokenHash), index('share_links_user_idx').on(t.userId, t.resourceType)]
)


export const calendarFeeds = pgTable(
  'calendar_feeds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('calendar_feeds_token_key').on(t.tokenHash), index('calendar_feeds_user_idx').on(t.userId)]
)


export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    failureCount: integer('failure_count').notNull().default(0),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_key').on(t.endpoint), index('push_subscriptions_user_idx').on(t.userId)]
)

export const flightNotificationState = pgTable(
  'flight_notification_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userFlightId: uuid('user_flight_id').notNull().references(() => userFlights.id, { onDelete: 'cascade' }),
    status: text('status'),
    scheduledDeparture: timestamp('scheduled_departure', { withTimezone: true }),
    scheduledArrival: timestamp('scheduled_arrival', { withTimezone: true }),
    depGate: text('dep_gate'),
    depTerminal: text('dep_terminal'),
    arrGate: text('arr_gate'),
    arrTerminal: text('arr_terminal'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('flight_notification_state_key').on(t.userId, t.userFlightId)]
)

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    dedupKey: text('dedup_key').notNull(),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notification_deliveries_key').on(t.userId, t.dedupKey)]
)
