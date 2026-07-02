"""HTML del panel de configuración por servidor (/server/{guild_id})."""

PANEL_HTML = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Purgito · Panel</title>
<link rel="stylesheet" href="/static/panel.css">
</head>
<body class="panel-page">
<aside class="sidebar">
  <div class="server-head" id="serverHead"></div>
  <nav id="catNav"></nav>
  <div class="sidebar-footer">
    <a href="/servers"><span class="nav-emoji">←</span><span class="nav-label">Mis servidores</span></a>
    <a href="/auth/logout"><span class="nav-emoji">⏻</span><span class="nav-label">Cerrar sesión</span></a>
  </div>
</aside>
<main class="content">
  <h1 id="catTitle"></h1>
  <div id="catContent"></div>
</main>
<script>const GUILD_ID = "{{GUILD_ID}}";</script>
<script src="/static/panel.js"></script>
<script>initPanel();</script>
</body>
</html>
"""
