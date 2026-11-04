export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function exportFlightCardPng(flight: {
  flightCode: string
  airlineName: string | null
  depCode: string
  arrCode: string
  departureTime: string
  arrivalTime: string
  duration: string
  status: string
}) {
  const scale = 2
  const width = 1080
  const height = 1080
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  // background
  ctx.fillStyle = '#0d0021'
  ctx.fillRect(0, 0, width, height)
  // subtle grid
  ctx.strokeStyle = 'rgba(143,134,214,0.15)'
  ctx.lineWidth = 1
  for (let x = 0; x < width; x += 60) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.stroke() }
  for (let y = 0; y < height; y += 60) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(width,y); ctx.stroke() }

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 34px system-ui'
  ctx.fillText('Gfloge', 64, 80)
  ctx.font = '14px system-ui'
  ctx.fillStyle = '#b9b2e8'
  ctx.fillText('Shared flight', 64, 108)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 72px system-ui'
  ctx.textAlign = 'center'
  ctx.fillText(flight.depCode, width * 0.3, height * 0.42)
  ctx.fillText('→', width * 0.5, height * 0.42)
  ctx.fillText(flight.arrCode, width * 0.7, height * 0.42)

  ctx.font = 'bold 40px system-ui'
  ctx.fillText(flight.flightCode, width / 2, height * 0.56)
  ctx.font = '20px system-ui'
  ctx.fillStyle = '#b9b2e8'
  ctx.fillText(flight.airlineName ?? '', width / 2, height * 0.62)

  ctx.fillStyle = '#ffffff'
  ctx.font = '22px system-ui'
  ctx.fillText(`${flight.departureTime}  →  ${flight.arrivalTime}`, width / 2, height * 0.72)
  ctx.fillText(`Duration ${flight.duration} · ${flight.status}`, width / 2, height * 0.77)

  ctx.textAlign = 'left'
  ctx.fillStyle = '#b9b2e8'
  ctx.font = '16px system-ui'
  ctx.fillText('Read-only shared view', 64, height - 64)

  downloadDataUrl(canvas.toDataURL('image/png'), `${flight.flightCode.replace(/\s+/g, '-')}.png`)
}

export function exportTripCardPng(trip: {
  title: string
  flights: Array<{ depCode: string; arrCode: string; flightCode: string }>
}) {
  const scale = 2
  const width = 1080
  const height = 1350
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = '#0d0021'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(143,134,214,0.15)'
  ctx.lineWidth = 1
  for (let x = 0; x < width; x += 60) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.stroke() }
  for (let y = 0; y < height; y += 60) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(width,y); ctx.stroke() }

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 34px system-ui'
  ctx.fillText('Gfloge', 64, 80)
  ctx.font = '14px system-ui'
  ctx.fillStyle = '#b9b2e8'
  ctx.fillText('Shared itinerary', 64, 108)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 48px system-ui'
  ctx.fillText(trip.title, 64, 180)

  let y = 260
  trip.flights.forEach((f, i) => {
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 28px system-ui'
    ctx.fillText(`${i + 1}. ${f.depCode} → ${f.arrCode}`, 64, y)
    ctx.font = '18px system-ui'
    ctx.fillStyle = '#b9b2e8'
    ctx.fillText(f.flightCode, 64, y + 30)
    y += 90
  })

  ctx.fillStyle = '#b9b2e8'
  ctx.font = '16px system-ui'
  ctx.fillText('Read-only shared view', 64, height - 64)

  downloadDataUrl(canvas.toDataURL('image/png'), `${trip.title.replace(/\s+/g, '-')}.png`)
}
