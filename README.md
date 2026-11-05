# משמרות — ניהול משמרות וחישוב שכר

ווב-אפליקציה קטנה לצוות: רישום משמרות, חישוב שעות (כולל מעבר חצות ושעון קיץ/חורף), סגירת תקופות תשלום, תעריף אפקטיבי וחלוקת סכום לפי שעות.

- `web/` — האתר (GitHub Pages). קבצים סטטיים, בלי build.
- `worker/` — ה-API (Cloudflare Worker + D1 בשם `shifts-db`).
- כל דחיפה ל-`main` מריצה בדיקות, מעדכנת את מסד הנתונים, פורסת את ה-Worker ואת האתר.

## סודות נדרשים (Settings → Secrets and variables → Actions)
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `APP_PASSWORD` — הסיסמה המשותפת לכניסה לאתר

## הרצה מקומית
```
cd worker && npm ci
echo 'APP_PASSWORD="test"' > .dev.vars
npx wrangler d1 migrations apply shifts-db --local
npx wrangler dev --local
# בטרמינל אחר: cd web && python3 -m http.server 8000
```
