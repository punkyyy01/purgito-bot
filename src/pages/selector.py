"""HTML de la página de selección de servidor (/servers)."""

SELECTOR_HTML = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Purgito · Mis servidores</title>
<link rel="stylesheet" href="/static/panel.css">
</head>
<body class="selector-page">
<header class="topbar">
  <div class="brand">Purgito</div>
  <div class="userbox">
    <img src="{{AVATAR_URL}}" alt="">
    <span>{{USERNAME}}</span>
    <a class="btn btn-secondary" href="/auth/logout">Cerrar sesión</a>
  </div>
</header>
<main class="selector-main">
  <h1>Tus servidores</h1>
  <div id="configured" class="card-grid"><div class="spinner"></div></div>
  <h1>Invitar Purgito</h1>
  <div id="available" class="card-grid"></div>
</main>
<script src="/static/panel.js"></script>
<script>initSelector();</script>
</body>
</html>
"""
