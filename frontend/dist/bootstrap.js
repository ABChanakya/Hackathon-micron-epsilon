// This entry must remain a classic script so that directly opened files can explain how to start.
(() => {
  const messages = {
    de: {title:'Sensor Cockpit über den Server öffnen',file:'Diese Datei wurde direkt geöffnet. Das Cockpit benötigt den lokalen Messserver.',start:'Starte im Projektordner ./start.sh und öffne anschließend das Cockpit.',open:'Sensor Cockpit öffnen',error:'Das Cockpit konnte nicht geladen werden.',retry:'Prüfe den Messserver und lade die Seite neu.',reload:'Seite neu laden'},
    en: {title:'Open Sensor Cockpit through the server',file:'This file was opened directly. The cockpit needs the local measurement server.',start:'Run ./start.sh in the project folder, then open the cockpit.',open:'Open Sensor Cockpit',error:'The cockpit could not be loaded.',retry:'Check the measurement server and reload this page.',reload:'Reload page'},
    fr: {title:'Ouvrir Sensor Cockpit via le serveur',file:'Ce fichier a été ouvert directement. Le cockpit nécessite le serveur de mesure local.',start:'Lancez ./start.sh dans le dossier du projet, puis ouvrez le cockpit.',open:'Ouvrir Sensor Cockpit',error:'Le cockpit n’a pas pu être chargé.',retry:'Vérifiez le serveur de mesure et rechargez cette page.',reload:'Recharger la page'},
    es: {title:'Abrir Sensor Cockpit desde el servidor',file:'Este archivo se ha abierto directamente. El cockpit necesita el servidor de medición local.',start:'Ejecuta ./start.sh en la carpeta del proyecto y abre el cockpit.',open:'Abrir Sensor Cockpit',error:'No se ha podido cargar el cockpit.',retry:'Comprueba el servidor de medición y vuelve a cargar esta página.',reload:'Recargar la página'},
    it: {title:'Apri Sensor Cockpit tramite il server',file:'Questo file è stato aperto direttamente. Il cockpit richiede il server di misura locale.',start:'Avvia ./start.sh nella cartella del progetto, poi apri il cockpit.',open:'Apri Sensor Cockpit',error:'Impossibile caricare il cockpit.',retry:'Controlla il server di misura e ricarica questa pagina.',reload:'Ricarica la pagina'},
    cs: {title:'Otevřít Sensor Cockpit přes server',file:'Tento soubor byl otevřen přímo. Cockpit vyžaduje místní měřicí server.',start:'Spusťte ./start.sh ve složce projektu a potom otevřete cockpit.',open:'Otevřít Sensor Cockpit',error:'Cockpit se nepodařilo načíst.',retry:'Zkontrolujte měřicí server a znovu načtěte tuto stránku.',reload:'Znovu načíst stránku'},
    zh: {title:'通过服务器打开 Sensor Cockpit',file:'此文件被直接打开。Cockpit 需要本地测量服务器。',start:'请在项目文件夹中运行 ./start.sh，然后打开 Cockpit。',open:'打开 Sensor Cockpit',error:'无法加载 Cockpit。',retry:'请检查测量服务器并重新加载此页面。',reload:'重新加载页面'},
    ja: {title:'サーバー経由で Sensor Cockpit を開く',file:'このファイルは直接開かれました。Cockpit にはローカル測定サーバーが必要です。',start:'プロジェクトフォルダーで ./start.sh を実行してから、Cockpit を開いてください。',open:'Sensor Cockpit を開く',error:'Cockpit を読み込めませんでした。',retry:'測定サーバーを確認し、このページを再読み込みしてください。',reload:'ページを再読み込み'},
    ko: {title:'서버를 통해 Sensor Cockpit 열기',file:'이 파일을 직접 열었습니다. Cockpit에는 로컬 측정 서버가 필요합니다.',start:'프로젝트 폴더에서 ./start.sh를 실행한 다음 Cockpit을 여세요.',open:'Sensor Cockpit 열기',error:'Cockpit을 불러올 수 없습니다.',retry:'측정 서버를 확인하고 이 페이지를 새로 고침하세요.',reload:'페이지 새로 고침'},
    pirate: {title:'Open Sensor Cockpit through the server, matey',file:'Ye opened this file directly. The cockpit needs the local measurement server.',start:'Run ./start.sh in the project folder, then board the cockpit.',open:'Board Sensor Cockpit',error:'The cockpit could not be loaded, matey.',retry:'Check the measurement server and reload this page.',reload:'Reload the page, matey'},
  };
  let language = 'de';
  const requested = new URLSearchParams(location.search).get('lang');
  if (Object.hasOwn(messages, requested)) language = requested;
  else {
    try {
      const stored = localStorage.getItem('landing-lang');
      if (Object.hasOwn(messages, stored)) language = stored;
    } catch { /* File URLs or privacy settings may deny storage access. */ }
  }
  const copy = messages[language], app = document.getElementById('app');
  const boot = app?.querySelector('.boot');
  function showStart(file) {
    // A startup failure must never replace an already running application.
    if (!boot || !app.contains(boot)) return;
    const card = document.createElement('main');
    card.id = 'main'; card.className = 'boot boot-start';
    const title = document.createElement('h1'); title.textContent = file ? copy.title : copy.error;
    const description = document.createElement('p'); description.textContent = file ? copy.file : copy.retry;
    if (!file) description.setAttribute('role', 'alert');
    card.append(title, description);
    if (file) {
      const instruction = document.createElement('p'); instruction.textContent = copy.start;
      const link = document.createElement('a'); link.className = 'btn primary'; link.textContent = copy.open;
      link.href = `http://127.0.0.1:8000/${language === 'de' ? '' : '?lang=' + language}#monitor`;
      card.append(instruction, link);
    } else {
      const reload = document.createElement('button'); reload.type = 'button'; reload.className = 'btn primary'; reload.textContent = copy.reload;
      reload.addEventListener('click', () => location.reload()); card.append(reload);
    }
    document.documentElement.lang = language === 'pirate' ? 'en' : language;
    app.replaceChildren(card);
  }
  if (location.protocol === 'file:') { showStart(true); return; }
  if (document.querySelector('script[data-cockpit-entry]')) return;
  const entry = document.createElement('script');
  entry.type = 'module'; entry.src = 'app.js?v=phone-live-1'; entry.dataset.cockpitEntry = '';
  entry.onerror = () => showStart(false);
  // The application renders synchronously; a completed entry must have replaced the boot text.
  entry.onload = () => showStart(false);
  document.head.append(entry);
})();
