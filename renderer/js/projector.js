const appendTextWithLineBreaks = (parent, value) => {
  const text = String(value ?? '');
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    if (index > 0) {
      parent.appendChild(document.createElement('br'));
    }

    parent.appendChild(document.createTextNode(line));
  });
};

const applyPreferences = (preferences) => {
  if (!preferences) {
    return;
  }

  document.body.style.fontFamily = preferences.fontFamily;
  document.body.style.fontSize = `${preferences.fontSize}px`;
  document.body.style.color = preferences.textColor;
  document.body.style.backgroundColor = preferences.backgroundColor;
  document.body.style.lineHeight = String(preferences.lineHeight);
  document.body.style.paddingTop = `${preferences.paddingTop}px`;
  document.body.style.paddingBottom = `${preferences.paddingBottom}px`;
  document.body.style.paddingLeft = `${preferences.paddingLeft}px`;
  document.body.style.paddingRight = `${preferences.paddingRight}px`;
};

ipcRenderer.on('display-lyrics', (lyrics) => {
  const lyricsRoot = document.getElementById('lyrics');
  lyricsRoot.replaceChildren();

  const paragraph = document.createElement('p');
  appendTextWithLineBreaks(paragraph, lyrics);
  lyricsRoot.appendChild(paragraph);
});

ipcRenderer.on('black-screen', () => {
  document.getElementById('lyrics').replaceChildren();
});

ipcRenderer.on('preferences:changed', (preferences) => {
  applyPreferences(preferences);
});

ipcRenderer.invoke('get-preferences').then(applyPreferences);
