var EventEmitter = require('events').EventEmitter,
    spotify_util = require('../node_modules/spotify-web/lib/util.js'),
    https = require('https'),
    spotify = require('spotify-web'),
    xml2js = require('xml2js');
    
function SpotifyClient(username, password) {
  this.username = username;
  this.password = password;
  EventEmitter.call(this);
}

SpotifyClient.super_ = EventEmitter;
SpotifyClient.prototype = Object.create(EventEmitter.prototype, {
  constructor: {
    value: SpotifyClient,
    enumerable: false
  }
});

SpotifyClient.prototype.newInstance = function(username, password) {
  return new SpotifyClient(username, password);
};

SpotifyClient.prototype.login = function() {
  var self = this;
  spotify.login(self.username, self.password, function(err, spotify){
    if(err){
      console.log(err);
      self.emit('error', 'error');
    }
    else{
      spotify.disconnect();
      self.emit('success', 'success');
    }
  });
  return self;
};

SpotifyClient.prototype.getPlayLists = function() {
  var self = this;

  //Login
  console.log('Connecting to Spotify for playlists');
  spotify.login(self.username, self.password, function(err, spotify) {
    if(err) throw err;

    //Rootlist
    spotify.rootlist(function(err, rootlist) {
      if(err) throw err;

      var rootItems = rootlist.contents.items;
      var playlists = new Array();
      
      rootItems.forEach(function(playlistObject, index){
        //Lookup playlist by uri
        spotify.playlist(playlistObject.uri, function(err, playlist) {
          if(err) throw err;

          playlist.playlistURI = playlistObject.uri;
          playlists.push(playlist);

          if(playlists.length == rootItems.length){
            console.log('Spotify disconnecting after playlists');
            spotify.disconnect();
            self.emit('playListsReady', playlists)
          }            
        });                                           
      });
    });
  });

  return self;  
};

SpotifyClient.prototype.getTracksByPlayListURI = function(uri) {
  var self = this;

  //Login
  console.log('Connecting to Spotify for playlist: '+uri);
  spotify.login(self.username, self.password, function(err, spotify) {
    if(err) throw err;

    spotify.playlist(uri, function(err, playlist) {
      if(err) throw err;  

      var playlistItems = playlist.contents.items;
      var tracks = new Array();

      playlistItems.forEach(function(trackObject, index){     
        //Lookup tracks by uri
        spotify.get(trackObject.uri, function(err, track){
          if(err) throw err;   
            track.trackURI = trackObject.uri;
            tracks.push(track);

            if(tracks.length == playlistItems.length){
              console.log('Spotify disconnecting after playlist: '+uri);
              spotify.disconnect();
              self.emit('tracksReady', tracks);
            }              
        });
      });
    });
  });   

  return self;
};

SpotifyClient.prototype.getTrackByTrackURI = function(uri){
  var self = this;
  console.log('Connecting to Spotify for /track/'+uri);
  spotify.login(self.username, self.password, function(err, spotify) {
    if(err) throw err;

    // first get a "Track" instance from the track URI
    spotify.get(uri, function(err, track) {
      if(err) throw err;

      console.log('Spotify disconnecting after /track/: '+uri);
      spotify.disconnect();
      self.emit('trackReady', track);
    });
  });

  return self;
}

SpotifyClient.prototype.getAlbumArtByTrackURI = function(uri){
  var self = this;
  self.getOembedResponseByURI(uri).on('end'+uri, function(data){
    self.emit('albumArtReady'+uri,data);
  });
  return self;
};

SpotifyClient.prototype.getOembedResponseById = function(uriType,id){
  var self = this;
  var uri = spotify_util.id2uri(uriType, id);
  self.getOembedResponseByURI(uri).on('end'+uri, function(data){
    self.emit('end'+id, data);
  });
  return self;  
};

SpotifyClient.prototype.getOembedResponseByURI = function(uri){
  var self = this;

  console.log('Connecting to Spotify OEMBED for: '+uri);
  options = {
    hostname: 'embed.spotify.com', 
    path: '/oembed/?url='+uri, 
    method: 'GET',
    headers:{
      'User-Agent': 'node.js'
    }
  };  

  var jsonData = '';

  var req = https.request(options,function(res){    
    //RESPONSE
    res.setEncoding('utf8');
    res.on('data', function(chunk){
      jsonData += chunk;
    });

    res.on('error', function(e){
      console.log('error:',e);
    });

    //RESPONSE END
    res.on('end', function(){
      self.emit('end'+uri, {itemGID: uri, oembed: JSON.parse(jsonData)});
    });  
  });

  req.on('error', function(e){
    console.log('Spotify OEMBED error after retrieving art for:'+uri+' error: '+e);
  });

  req.end();  

  return self;
}

SpotifyClient.prototype.playTrackByURI = function(uri, res){
  var self = this;

  console.log('Connecting to Spotify for /'+uri);
  spotify.login(self.username, self.password, function(err, spotify) {
    if(err) throw err;

    // first get a "Track" instance from the track URI
    spotify.get(uri, function(err, track) {
      if(err) throw err;
      console.log('Streaming: %s - %s', track.artist[0].name, track.name);

      // play() returns a readable stream of MP3 audio data
      track.play()
        .pipe(res)
        .on('error', function(e){
          console.log('Error while piping stream to client:',e);
          spotify.disconnect();
        })
        .on('unpipe', function() {
          console.log('Unpipe detected, disconnecting for /'+uri);
          spotify.disconnect();
        })
        .on('finish', function() {
          console.log('Spotify disconnecting for /'+uri);
          spotify.disconnect();
        });
    });
  });
}

SpotifyClient.prototype.search = function(query){
  var self = this;

  console.log('Connecting to Spotify for /search/'+query);  
  spotify.login(self.username, self.password, function(err, spotify) {
    if (err) throw err;

    spotify.search(query,function(err,xml) {
      if (err) throw err;

      console.log('Disconnecting from Spotify after /search/'+query)
      spotify.disconnect();

      var parser = new xml2js.Parser();
      parser.on('end', function(data) {
        var parseResults = self.parseSearchResults(data);

        parseResults.on('parseSearchResultsComplete', function(data){
          self.emit('searchResultsReady', data);
        });
      });      
      parser.parseString(xml);
    });    
  });  

  return self;
};

SpotifyClient.prototype.parseSearchResults = function(data){
  var self = this;
  var tracks = data.result.tracks;

  var numToReturn = 30;
  var results = new Object();
  var returnTracks = new Array();
  
  if(typeof(tracks) == 'undefined' || typeof(tracks[0].track) =='undefined' || typeof(tracks[0].track[0]) == 'undefined'){
    self.emit('searchResultsError', results);
    return self;
  }

  for(var i=0; i<numToReturn; i++){

    try{
      var trackId = tracks[0].track[i].id[0];
    }
    catch(err){
      self.emit('searchResultsError', results);
      break;
    }

    self.getOembedResponseById('track', trackId).on('end'+trackId, function(trackData){
      returnTracks.push({data: trackData});
      if(returnTracks.length==numToReturn)
        self.emit('searchTracksReady', returnTracks);
    });        
  }

  self.on('searchTracksReady', function(data){
    results.tracks = data;
    self.emit('parseSearchResultsComplete', results);
  });

  return self;
};

module.exports = new SpotifyClient();    