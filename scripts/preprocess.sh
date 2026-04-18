#!/usr/bin/env bash
set -euo pipefail

# Reproject INEGI Lambert Conformal Conic shapefiles to WGS84 GeoJSON.
# Runtime lat/lng queries are WGS84, so projection must happen here once.

OGR2OGR="/opt/homebrew/bin/ogr2ogr"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

GEOJSON_DIR="$ROOT/data/geojson"
CATALOGS_DIR="$ROOT/data/catalogs"

mkdir -p "$GEOJSON_DIR" "$CATALOGS_DIR"

RAW_DIR="$ROOT/data/raw"
COLIMA_SHP="$RAW_DIR/06_colima_colonias/conjunto_de_datos/06as.shp"
JALISCO_SHP="$RAW_DIR/14_jalisco_colonias/conjunto_de_datos/14as.shp"
COLIMA_MUN_SHP="$RAW_DIR/06_colima_geoestadistico/conjunto_de_datos/06mun.shp"
JALISCO_MUN_SHP="$RAW_DIR/14_jalisco_geoestadistico/conjunto_de_datos/14mun.shp"
CATALOG_SRC="$RAW_DIR/catun_municipio/AGEEML_202631880673_utf8.csv"

COLIMA_OUT="$GEOJSON_DIR/06as.geojson"
JALISCO_OUT="$GEOJSON_DIR/14as.geojson"
COLIMA_MUN_OUT="$GEOJSON_DIR/06mun.geojson"
JALISCO_MUN_OUT="$GEOJSON_DIR/14mun.geojson"
CATALOG_OUT="$CATALOGS_DIR/municipios.csv"

echo "Reprojecting Colima asentamientos..."
rm -f "$COLIMA_OUT"
"$OGR2OGR" -f GeoJSON -t_srs EPSG:4326 "$COLIMA_OUT" "$COLIMA_SHP"

echo "Reprojecting Jalisco asentamientos..."
rm -f "$JALISCO_OUT"
"$OGR2OGR" -f GeoJSON -t_srs EPSG:4326 "$JALISCO_OUT" "$JALISCO_SHP"

echo "Reprojecting Colima municipios..."
rm -f "$COLIMA_MUN_OUT"
"$OGR2OGR" -f GeoJSON -t_srs EPSG:4326 "$COLIMA_MUN_OUT" "$COLIMA_MUN_SHP"

echo "Reprojecting Jalisco municipios..."
rm -f "$JALISCO_MUN_OUT"
"$OGR2OGR" -f GeoJSON -t_srs EPSG:4326 "$JALISCO_MUN_OUT" "$JALISCO_MUN_SHP"

echo "Copying AGEEML catalog..."
cp "$CATALOG_SRC" "$CATALOG_OUT"

COLIMA_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).features.length)" "$COLIMA_OUT")
JALISCO_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).features.length)" "$JALISCO_OUT")
COLIMA_MUN_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).features.length)" "$COLIMA_MUN_OUT")
JALISCO_MUN_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).features.length)" "$JALISCO_MUN_OUT")

echo "Done."
echo "  Colima asentamientos:  $COLIMA_COUNT"
echo "  Jalisco asentamientos: $JALISCO_COUNT"
echo "  Colima municipios:     $COLIMA_MUN_COUNT"
echo "  Jalisco municipios:    $JALISCO_MUN_COUNT"
echo "  Catalog:               $CATALOG_OUT"
