const childProcess = require("child_process");
const http = require("http");
const { URLSearchParams } = require("url");
const { google } = require("googleapis");
const chunk = require("lodash/chunk");
const keyBy = require("lodash/keyBy");
const groupBy = require("lodash/groupBy");
const countries = require("countries-code");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000"
);

const scopes = ["https://www.googleapis.com/auth/youtube"];

const url = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: scopes,
  response_type: "code",
  redirect_uri: "http://localhost:3000",
});

const start = async () => {
  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client,
  });

  let nextPageToken;

  const subscriptions = [];
  do {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await new Promise((resolve, reject) => {
      youtube.subscriptions.list(
        {
          part: "snippet",
          mine: true,
          maxResults: 50,
          pageToken: nextPageToken,
        },
        // eslint-disable-next-line no-shadow
        (err, data) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(data);
        }
      );
    });

    subscriptions.push(...data.items);
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  const channels = (
    await Promise.all(
      chunk(subscriptions, 50).map(async (subscriptionsChunk) => {
        const { data } = await new Promise((resolve, reject) => {
          youtube.channels.list(
            {
              part: "snippet",
              pageToken: nextPageToken,
              id: subscriptionsChunk
                .map(({ snippet }) => snippet.resourceId.channelId)
                .join(","),
            },
            // eslint-disable-next-line no-shadow
            (err, data) => {
              if (err) {
                reject(err);
                return;
              }

              resolve(data);
            }
          );
        });

        return data.items;
      })
    )
  ).flat(1);

  const subscriptionsByChannelId = keyBy(
    subscriptions,
    ({ snippet }) => snippet.resourceId.channelId
  );
  const ruChannels = channels.filter(({ snippet }) => snippet.country === "RU");

  // eslint-disable-next-line no-unused-vars
  const channelsByCountry = groupBy(channels, ({ snippet }) => snippet.country);
  const channelsPercentageByCountry = channels.reduce(
    (acc, { snippet }) => ({
      ...acc,
      [snippet.country ? countries.getCountry(snippet.country) : "-"]:
        (acc[snippet.country ? countries.getCountry(snippet.country) : "-"] ??
          0) +
        100 / channels.length,
    }),
    {}
  );
  // eslint-disable-next-line no-console
  console.log(channelsPercentageByCountry);

  const ruChannelsSubscriptionsIds = ruChannels.map(
    ({ id }) => subscriptionsByChannelId[id].id
  );

  await Promise.all(
    ruChannelsSubscriptionsIds.map(
      (id) =>
        new Promise((resolve, reject) => {
          youtube.subscriptions.delete(
            {
              id,
            },
            (err, data) => {
              if (err) {
                reject(err);
                return;
              }

              resolve(data);
            }
          );
        })
    )
  );
};

const server = http.createServer(async (req, res) => {
  const code = new URLSearchParams(req.url.replace(/^(.+)?\/\?/, "")).get(
    "code"
  );

  if (!code) {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  await start();
});

server.listen(3000);

childProcess.exec(`open "${url}"`);
