const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
var SpotifyWebApi = require('spotify-web-api-node');
const spotifyScopes = ['playlist-modify-public',
  'playlist-read-private',
  'playlist-modify-private'
]

const webservicePort = 80
const servingUrl = `http://${process.env.PUBLIC_IP}:${webservicePort}/callback`

let chats = { '358405686455-1597149862@g.us': true }
const playlistId = "1RuXVd1wpfXxBlWsOSmGqX"
let playlistContent = []
const maxPlaylistLength = 100

const linkRegexp = new RegExp("https://open\.spotify\.com/track/[a-zA-Z0-9]+")

/*******************
* Spotify Client
******************/
const app = express();
const spotifyApi = new SpotifyWebApi({
  redirectUri: servingUrl,
  clientId: process.env.SPOTIFY_ID,
  clientSecret: process.env.SPOTIFY_SECRET,
});

console.log(process.env.SPOTIFY_ID, ' / ', process.env.SPOTIFY_SECRET)

app.get('/callback', (req, res) => {
  const error = req.query.error;
  const code = req.query.code;
  const state = req.query.state;

  if (error) {
    console.error('Callback Error:', error);
    res.send(`Callback Error: ${error}`);
    return;
  }

  spotifyApi
    .authorizationCodeGrant(code)
    .then(data => {
      const access_token = data.body['access_token'];
      const refresh_token = data.body['refresh_token'];
      const expires_in = data.body['expires_in'];

      spotifyApi.setAccessToken(access_token);
      spotifyApi.setRefreshToken(refresh_token);

      console.log('access_token:', access_token);
      console.log('refresh_token:', refresh_token);

      console.log(
        `Sucessfully retreived Spotify token. Expires in ${expires_in} s.`
      );
      res.send('Success! You can now close the window.');
      setInterval(async () => {
        const data = await spotifyApi.refreshAccessToken();
        const access_token = data.body['access_token'];

        console.log('The Spotify token has been refreshed');
        spotifyApi.setAccessToken(access_token);
      }, expires_in / 2 * 1000);

      return spotifyApi.getPlaylistTracks(playlistId)
    })
    .then( data => {
      for ( const { track } of data.body.items ) {
        playlistContent.push(track.id)
      }
      console.log(`Playlist has ${data.body.total} track(s)`)
      console.log("Logging into WhatsApp")
      waClient.initialize();
    })
    .catch(error => {
      console.error('Error getting Tokens:', error);
      res.send(`Error getting Tokens: ${error}`);
    });
});

app.listen(webservicePort, () => {
  let authUrl = spotifyApi.createAuthorizeURL(spotifyScopes)
  console.log(
    `HTTP Server up. Now go to ${authUrl} in your browser.`
  )
});


/*****************
* WhatsApp Client
******************/
const waClient = new Client({
  authStrategy: new LocalAuth(),
	puppeteer: {
		args: ['--no-sandbox'],
	}
});
const reactions = {
  added: "🤖",
  robot: "🤖",
  started: "✅️",
  stopped: "🛑"
}
 
waClient.on('qr', (qr) => {
    // Generate and scan this code with your phone
    // console.log('QR RECEIVED', qr);
    qrcode.generate(qr, {small: true});
});

waClient.on('ready', () => {
    console.log('WA Client is ready!');
});

waClient.on('message_create', msg => {
  //if (msg.from != chatId) return; // Ignore other chats

  if (msg.body.startsWith('!spotify')) {

    const command = msg.body.split(" ")[1];
    switch (command) {
      case "start":
        chats[msg.from] = true
        console.log(`Started following chat ${msg.from}`)
        msg.react(reactions.started).then(() => {
          msg.reply(`${reactions.robot}: "I will start looking for Spotify links in this chat"`)
        })
        break;

      case "stop":
        chats[msg.from] = false
        msg.react(reactions.stopped)
        console.log(`Stopped following chat ${msg.from}`)
        break;

      case "help":
        msg.reply(`Usage:
  !spotify        Get link to the playlist
  !spotify start  Start following this chat
  !spotify stop   Stop following this chat
  !spotify help   This help`);
        break;

      default:
        msg.reply(`https://open.spotify.com/playlist/${playlistId}`);
    }
    return;
  }

  if (!chats[msg.from]) return;

  let links = msg.body.match(linkRegexp)
  if (!links) return;
  const url = new URL(links[0])
  // "/track/{{trackID}}" -> "{{trackID}}"
  const trackId = url.pathname.split('/')[2]
  if (playlistContent.includes(trackId) ) {
    console.log(`Already on playlist, trackID: ${trackId}`)
  } else {
    console.log(`Not on playlist yet, trackID: ${trackId}`)
    spotifyApi.addTracksToPlaylist( playlistId, [`spotify:track:${trackId}`] )
    .then( () => {
      playlistContent.push(trackId);
      console.log(`Added to playlist, it now has ${playlistContent.length} tracks`)
      return msg.react(reactions.added)
    })
    .then( () => {
      upkeepList()
    })
    .catch(error => {
      console.error('Error adding to playlist:', error);
    });
  }
});

const upkeepList = () => {
  const removeTracks = []
  while(playlistContent.length > maxPlaylistLength) {
    removeTracks.push(playlistContent.shift())
  }
  if(removeTracks.length > 0){
    console.log(`Removing old ${removeTracks.length} track(s) from playlist`)
    spotifyApi.removeTracksFromPlaylist(playlistId, removeTracks.map( trackId => `spotify:track:${trackId}`))
    .then( () => {
      console.log('Upkeep done')
    })
    .catch(error => {
      console.error(`Upkeep failed: `, error)
    })
  }
}
