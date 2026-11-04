# Bundled Board geography

The compressed GeoJSON files are filtered from Natural Earth 1:50m public-domain vector data. The upstream GeoJSON conversion is CC0-1.0.

- `ne-50m-countries.geojson.gz`: admin-0 countries including lakes; polygons retain their source WGS84 coordinates and country names/ranks.
- `ne-50m-places.geojson.gz`: Natural Earth populated places (scale rank 0–5); retains source point coordinates and label ranks.
- Source: <https://github.com/martynafford/natural-earth-geojson> (dataset snapshot dated 2024-01-24)
- Natural Earth terms: <https://www.naturalearthdata.com/about/terms-of-use/>
- Upstream GeoJSON conversion license: <https://github.com/martynafford/natural-earth-geojson/blob/master/licence>

Airport positions are not taken from this dataset. The atlas plots the airport latitude/longitude already returned with each flight from Gfloge's reference data. No map tile service or network map API is used.
