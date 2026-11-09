# DuoTrace

DuoTrace is an ASP.NET Core MVC app for comparing two League of Legends Riot IDs (`GameName#TAG`). It uses Riot's Account and Match APIs to find shared games and summarize same-team matches, win rate, and match details.

The app supports Riot's Americas, Europe, Asia, and Southeast Asia routing clusters. Recent shared matches appear first while older available match history is scanned.
