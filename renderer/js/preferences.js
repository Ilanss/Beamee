const fontSelect = document.getElementById('font-family');
const preferences = ipcRenderer.sendSync('get-preferences');

const fonts = [
  "Arial", 
"Arial Black", 
"Courier New", 
"Georgia", 
"Impact", 
"Lucida Console", 
"Lucida Sans Unicode", 
"Palatino Linotype", 
"Tahoma", 
"Times New Roman", 
"Trebuchet MS", 
"Verdana",
"MS Sans Serif",
"MS Serif"
]

// Charger les polices disponibles sur l'ordinateur
document.fonts.ready.then(() => {
  fonts.forEach(font => {
    const option = document.createElement('option');
    option.value = font;
    option.text = font;
    fontSelect.add(option);
  });
});

document.fonts.ready.then((fontFaceSet) => {
  console.log(fontFaceSet);
  // Any operation that needs to be done only after all used fonts
  // have finished loading can go here.
  const fontFaces = [...fontFaceSet];
  console.log(fontFaces);
  // some fonts may still be unloaded if they aren't used on the site
  console.log(fontFaces.map((f) => f.status));
});

document.getElementById('font-family').setAttribute('value', preferences.fontFamily);
document.getElementById('font-size').setAttribute('value', preferences.fontSize);
document.getElementById('text-color').setAttribute('value', preferences.textColor);
document.getElementById('background-color').setAttribute('value', preferences.backgroundColor);

document.getElementById('preferences-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const preferences = {
    fontFamily: document.getElementById('font-family').value,
    fontSize: document.getElementById('font-size').value,
    textColor: document.getElementById('text-color').value,
    backgroundColor: document.getElementById('background-color').value,
  };
  ipcRenderer.send('save-preferences', preferences);
  window.close();
});
