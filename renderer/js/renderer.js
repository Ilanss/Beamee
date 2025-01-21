const toggleProjectionButton = document.querySelector('#toggle-projection');
const prevVerse = document.querySelector('#prev-verse');
const nextVerse = document.querySelector('#next-verse');
const blackScreen = document.querySelector('#black-screen');
const main = document.querySelector('#verse-display ul');
const libraryListContainer = document.querySelector('#library-list ul');
const favoritesListContainer = document.querySelector('#favorites-list');
const favoritesPath = "favorites.json";
const previewContent = document.querySelector('#preview');
const createSongFolderButton = document.querySelector('#create-song-folder');
const createPlaylistButton = document.querySelector('#create-playlist');

let currentVerseIndex;
let currentLyrics;
let libraryList;

function toggleProjection() {
    ipcRenderer.send('projection:toggle');
}

ipcRenderer.on("projection:status", (isProjectionOn) => {
    if (isProjectionOn) {
        toggleProjectionButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-4"><rect width="10" height="10" x="3" y="3" rx="1.5" /></svg>';
    } else {
        toggleProjectionButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-4"><path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531l-6.706 4.268A1.5 1.5 0 0 1 3 12.267V3.732Z" /></svg>';
    }

    if (currentVerseIndex !== undefined) {
        updateProjection();
    }
})

ipcRenderer.on("black-screen", () => {
    currentVerseIndex = undefined;
    previewContent.innerText = '';
})

ipcRenderer.on("projection:next", () => {
    changeToNextVerse();
})

ipcRenderer.on("projection:prev", () => {
    changeToPrevVerse();
})

ipcRenderer.on("library:list", (files) => {
    createFileList(files, libraryListContainer);
})

ipcRenderer.on("favorites:list", (favorites) => {
    createFavoritesList(favorites);
})

ipcRenderer.on("verse:change", (verse) => {
    currentVerseIndex = verse;
    updateProjection();
})

function createFavoritesList(favorites) {
    // favorites = JSON.parse(window.fs.readFileSync(favoritesPath, 'utf8'));

    favorites.forEach(favorite => {
        let li = document.createElement('li');
        let a = document.createElement('a');

        const details = document.createElement('details');
        // details.setAttribute('open', '');

        const summary = document.createElement('summary');

        summary.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
            ${favorite.name}
            `;

        const ul = document.createElement('ul');
        details.appendChild(summary);
        details.appendChild(ul);

        // li.innerText = file.name;
        // let ul = document.createElement('ul');
        favorite.songs.forEach(song => {
            let liSong = document.createElement('li');
            let aSong = document.createElement('a');
                
            aSong.innerHTML = `  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
            </svg>
            ${song.name}`
            liSong.appendChild(aSong);
            // li.innerText = songData.id + " " + songData.name;
            liSong.setAttribute('id', song.id);
            // li.setAttribute('class', 'song p-2.5 mt-3 flex items-center rounded-md px-4 duration-300 cursor-pointer hover:bg-blue-600 text-white');
            
            liSong.addEventListener('click', () => {
                document.querySelectorAll('li a').forEach(function(aSong) {
                    aSong.classList.remove('active');
                });
                
                liSong.querySelector('a').classList.add("active");
                loadSong(song.path);
            });
            
            details.querySelector('ul').appendChild(liSong);
        })
        
        li.appendChild(details);

        favoritesListContainer.querySelector('ul').appendChild(li);
    });
}

function createFileList(files, container) {
    libraryList = files;
    files.forEach(file => {
        let li = document.createElement('li');
        let a = document.createElement('a');

        if (file.isDirectory) {
            const details = document.createElement('details');
            // details.setAttribute('open', '');

            const summary = document.createElement('summary');

            summary.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                ${file.name}
                `;

            const ul = document.createElement('ul');
            details.appendChild(summary);
            details.appendChild(ul);

            li.appendChild(details);

            // li.innerText = file.name;
            // let ul = document.createElement('ul');
            createFileList(file.children, ul);
            // li.setAttribute('class', 'directory p-2.5 mt-3 flex items-center rounded-md px-4 duration-300 cursor-pointer hover:bg-blue-600 text-white');
            // li.appendChild(ul);
        } else {
            const songData = JSON.parse(window.fs.readFileSync(file.path, 'utf8'));
            a.innerHTML = `  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
                </svg>
                ${songData.name}`
            li.appendChild(a);
            // li.innerText = songData.id + " " + songData.name;
            li.setAttribute('id', file.id);
            li.classList.add('draggable');
            // li.setAttribute('class', 'song p-2.5 mt-3 flex items-center rounded-md px-4 duration-300 cursor-pointer hover:bg-blue-600 text-white');

            li.addEventListener('click', () => {
                document.querySelectorAll('li a').forEach(function(a) {
                    a.classList.remove('active');
                });

                li.querySelector('a').classList.add("active");
                loadSong(file.path);
            });
        }

        container.appendChild(li);
    });
}

function loadSong(songPath) {
    main.innerHTML = "";
    const songData = JSON.parse(window.fs.readFileSync(songPath, 'utf8'));
    currentLyrics = songData.lyrics;
    songData.lyrics.forEach((verse, i) => {
        let li = document.createElement('li');
        let formattedText = verse.text.replace(/\\n/g, '<br>');
        li.innerHTML = `<p class="mt-2 text-xs uppercase">#${i + 1} ${verse.type}</p>` + formattedText;
        li.setAttribute('id', `verse-${i}`);
        li.classList.add("bg-gray-100", "rounded-md", "p-2", "px-4", "pb-3", "hover:bg-gray-200", "active:bg-gray-300", "dark:bg-slate-800", "hover:dark:bg-slate-700")

        li.addEventListener('click', () => {
            currentVerseIndex = i;
            updateProjection();
        });

        main.appendChild(li);
    })

    document.querySelector('#song-name').innerText = songData.name;
    ipcRenderer.send('song:loaded', songData.lyrics.length);
}

// function displayLyrics(sections) {
//     currentLyrics = sections;
//     currentVerseIndex = 0;
//     const lyricsContent = document.getElementById('lyrics-content');
//     lyricsContent.innerHTML = sections.map((section, index) => 
//       `<p data-index="${index}" class="${section.type}">${section.lines.join('<br>')}</p>`
//     ).join('');
//     document.querySelectorAll('#lyrics-content p').forEach(p => {
//       p.addEventListener('click', () => {
//         currentVerseIndex = parseInt(p.getAttribute('data-index'));
//         updateProjection();
//       });
//     });
//     updateProjection();
// }

function updateProjection() {
    let formattedText = currentLyrics[currentVerseIndex].text.replace(/\\n/g, '<br>');
    previewContent.innerHTML = `<p>${formattedText}</p>`;  

    ipcRenderer.send('display-lyrics', formattedText);
}

function changeToPrevVerse() {
    if(currentVerseIndex !== undefined && currentVerseIndex > 0) {
        currentVerseIndex--;
        updateProjection();
    }
}

function changeToNextVerse() {
    if(currentVerseIndex !== undefined && currentVerseIndex < currentLyrics.length - 1) {
        currentVerseIndex++;
        updateProjection();
    }
}

toggleProjectionButton.addEventListener('click', toggleProjection);

nextVerse.addEventListener('click', () => {
    changeToNextVerse();
})

prevVerse.addEventListener('click', () => {
    changeToPrevVerse();
})

document.getElementById('black-screen').addEventListener('click', () => {
    previewContent.innerText = '';
    currentVerseIndex = undefined;
    ipcRenderer.send('black-screen');
});

// document.addEventListener("DOMContentLoaded", function(event) { 
//     createFavoritesList();
//   });

// Sortable.js


/* var favoritesSortable = Sortable.create(favoritesListContainer.querySelector('ul'), {
    // group: {
    //     name: 'favorites',
    //     put: 'library',
    // },
    group: 'shared',
    animation: 150,
    handle: '.draggable',
    onAdd: function (evt) {
        // This event is fired when an item is added to the list
        const item = evt.item;
        if (item.parentNode !== evt.from) {
            item.setAttribute('draggable', 'true');
            item.classList.add('draggable');
        }
    }
});

var librarySortable = Sortable.create(libraryListContainer, {
    // sort: false,
    // draggable: ".draggable",
    // group: {
    //     name: 'library',
    //     pull: 'clone',
    // }
    group: {
        name: 'shared',
        pull: 'clone',
        put: false
    },
    sort: false,
    handle: '.handle'}); */


    var favoritesSortable = Sortable.create(favoritesListContainer.querySelector('ul'), {
    group: {
        name: 'favorites',
        put: 'library',
    },
});

var librarySortable = Sortable.create(libraryListContainer, {
    sort: false,
    draggable: ".draggable",
    group: {
        name: 'library',
        pull: 'clone',
    }
});