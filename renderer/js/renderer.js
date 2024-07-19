const toggleProjectionButton = document.querySelector('#toggle-projection');
const prevVerse = document.querySelector('#prev-verse');
const nextVerse = document.querySelector('#next-verse');
const blackScreen = document.querySelector('#black-screen');
const main = document.querySelector('#main');
const libraryListContainer = document.querySelector('#library-list ul');
const favoritesListContainer = document.querySelector('#favorites-list');

let libraryList;

function toggleProjection() {
    ipcRenderer.send('projection:toggle');
}

ipcRenderer.on("projection:status", (isProjectionOn) => {
    console.log(isProjectionOn);
    if (isProjectionOn) {
        toggleProjectionButton.innerHTML = "Stop projection";
    } else {
        toggleProjectionButton.innerHTML = "Start projection";
    }
})

ipcRenderer.on("library:list", (files) => {
    console.log(files);

    console.log(libraryListContainer);
    
    createFileList(files, libraryListContainer);
})

function createFileList(files, container) {
    libraryList = files;
    files.forEach(file => {
        let li = document.createElement('li');
        li.innerText = file.name;

        if (file.isDirectory) {
            let ul = document.createElement('ul');
            createFileList(file.children, ul);
            li.appendChild(ul);
        }

        container.appendChild(li);
    });
}

toggleProjectionButton.addEventListener('click', toggleProjection);