const logger = require('./logger');

const Twitter = require('twitter');

module.exports = function(config) {
  const twitter = new Twitter(config);

  this.postStatus = async function(text, imageData, in_reply_to) {
    if (in_reply_to) {
      var reply = await getStatusesShow(twitter, in_reply_to);
      screen_name = reply.user.screen_name;
      var mentions = reply.text.match(/@[a-zA-Z0-9_]*/g);
      if (mentions != null) {
        for (var name of mentions) {
          if (screen_name.indexOf(name) == -1 && name != config.screen_name) {
            screen_name = screen_name + ' ' + name;
          }
        }
      }
      logger.log(`in reply to @${screen_name}`);
    }
    
    var media = await postMediaUpload(twitter, imageData);
    
    var status = {
      status: text,
      media_ids: media.media_id_string
    }
    
    if (in_reply_to) {
      status.status = `@${screen_name} ${text}`;
      status.in_reply_to_status_id = in_reply_to;
    }
    
    var tweet = await postStatusesUpdate(twitter, status)
   
    logger.log(`tweet id ${tweet.id}`);
  
    logger.log('done');
  }
  
  function getStatusesShow(twitter, id) {
    return new Promise(function(resolve, reject) {
      twitter.get("statuses/show/" + id, {}, function(error, media, response) {
        if (error) {
          reject(error);
        } else {
          logger.log(`GET statuses/show: ${response.statusCode} ${response.statusMessage}`);
          resolve(media);
        }
      });    
    });
  }
  
  function postMediaUpload(twitter, imageData) {
    return new Promise(function(resolve, reject) {
      twitter.post("media/upload", {media: imageData}, function(error, media, response) {
        if (error) {
          reject(error);
        } else {
          logger.log(`POST media/upload: ${response.statusCode} ${response.statusMessage}`);
          resolve(media);
        }
      });    
    });
  }
  
  function postStatusesUpdate(twitter, status) {
    return new Promise(function(resolve, reject) {
      twitter.post("statuses/update", status, function(error, tweet, response) {
        if (error) {
          reject(error);
        } else {
          logger.log(`POST statuses/update: ${response.statusCode} ${response.statusMessage}`);
          resolve(tweet);
        }
      });
    });
  }

  this.openStream = function(callback) {
    var stream = twitter.stream('statuses/filter', {track: `@${config.screen_name}`});
    stream.on('data', (tweet) => onTweet(tweet, callback));
    stream.on('response', response => logger.log(`stream response: ${response.statusCode}`));
    stream.on('error', error => {
      logger.log('error: ' + JSON.stringify(error));
      if (timeout < 320000) {
        if (timeout < 5000) {
          timeout = 5000;
        } else {
          timeout *= 2;
        }
      }
    });
    stream.on('end', response => {
      if (timeout < 16000) {
        timeout += 250;
      }
      logger.log(`stream end: ${response.statusCode}, reconnect in ${timeout / 1000}`);
      setTimeout(openStream, timeout);
    });
  }
  
  async function onTweet(tweet) {
    timeout = 0;
    if (shouldReply(tweet)) {
      await callback(tweet.id_str);
    }
  }
  
  function shouldReply(tweet) {
    if (tweet.user.screen_name == config.screen_name) {
      return false;
    }
    if (tweet.retweeted_status) {
      logger.log(`retweet by ${tweet.user.screen_name}`);
      return false;
    }
    if (tweet.in_reply_to_status_id_str) {
      logger.log(`reply by ${tweet.user.screen_name}: ${tweet.text}`);
      return hasUserMention(tweet);
    }
    if (tweet.quoted_status_id_str) {
      logger.log(`quote by ${tweet.user.screen_name}: ${tweet.text}`);
      return hasUserMention(tweet);
    }
    logger.log(`mention by ${tweet.user.screen_name}: ${tweet.text}`);
    return true;
  }
  
  function hasUserMention(tweet) {
    var display_text_range = 0;
    if (tweet.extended_tweet) {
      if (tweet.extended_tweet.display_text_range) {
        display_text_range = tweet.extended_tweet.display_text_range[0];
      }
      for (var user_mention of tweet.extended_tweet.entities.user_mentions) {
        if (user_mention.screen_name == config.screen_name && user_mention.indices[0] >= display_text_range) {
          return true;
        }
      }
    }
    if (tweet.display_text_range) {
      display_text_range = tweet.display_text_range[0];
    }
    for (var user_mention of tweet.entities.user_mentions) {
      if (user_mention.screen_name == config.screen_name && user_mention.indices[0] >= display_text_range) {
        return true;
      }
    }
    return false;
  }
}
