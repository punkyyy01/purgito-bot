"""Test de MusicPlayer.elapsed() (music_player.py): tras una pausa, el tiempo
pausado no debe contarse como progreso de la canción -- ver pause()/resume()
que llevan la cuenta de _paused_total/_paused_at."""

from music_player import MusicPlayer


def test_elapsed_excludes_paused_time(monkeypatch):
    player = MusicPlayer(guild_id=1)
    clock = [100.0]  # arranca en un valor != 0: _play_start=0.0 se lee como "sin canción"
    monkeypatch.setattr("music_player.time.monotonic", lambda: clock[0])

    player._play_start = clock[0]

    clock[0] = 105.0
    assert player.elapsed() == 5

    player._paused_at = clock[0]  # simula pause() sin voice_client real
    clock[0] = 115.0  # 10s pausado
    assert player.elapsed() == 5  # no avanza mientras está pausado

    player._paused_total += clock[0] - player._paused_at  # simula resume()
    player._paused_at = None
    clock[0] = 120.0
    assert player.elapsed() == 10  # 20 transcurridos - 10 pausados
