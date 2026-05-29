# MOOVU Vercel Project Routing

Deploy each project from its own folder so Vercel receives the correct source.

## MOOVU App

Folder:

```text
D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign
```

Vercel project:

```text
moovu-app
```

Deploy command:

```powershell
.\scripts\deploy-moovu-app.ps1
```

## MOOVU Home Page

Folder:

```text
D:\Users\KN Mudau\Desktop\Websites\Moovu-home-page-website
```

Vercel project:

```text
moovu-app-r9pm
```

Deploy command:

```powershell
.\deploy-moovu-home.ps1
```

Both scripts fail early if the folder is linked to the wrong Vercel project.
