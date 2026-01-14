#!/bin/bash

echo "🔍 DIAGNÓSTICO DO REFLUX"
echo "========================"
echo ""

BASE_URL="http://localhost:3000"

echo "1️⃣ Testando servidor..."
if curl -s "$BASE_URL/health" > /dev/null 2>&1; then
    echo "✅ Servidor rodando"
else
    echo "❌ Servidor OFF - Execute: npm start"
    exit 1
fi

echo ""
echo "2️⃣ Testando manifest..."
curl -s "$BASE_URL/manifest.json" | head -n 5
echo ""

echo "3️⃣ Testando catálogo de filmes..."
movies=$(curl -s "$BASE_URL/catalog/movie/topflix-movies.json" | grep -o '"id"' | wc -l)
echo "Filmes: $movies"

echo ""
echo "4️⃣ Testando catálogo de séries..."
series=$(curl -s "$BASE_URL/catalog/series/topflix-series.json" | grep -o '"id"' | wc -l)
echo "Séries: $series"

echo ""
echo "========================"
echo "🔗 URL PARA O STREMIO:"
echo "$BASE_URL/manifest.json"
echo "========================"
