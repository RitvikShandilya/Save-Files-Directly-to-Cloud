var fs = require('fs');
var request = require('request');
var _ = require('underscore');
var path = require('path');
var prettysize = require('prettysize');
var progressStream = require('progress-stream');
var crypto = require('crypto');
var prettyTime = require('pretty-time');
var Email = require('./Email');

module.exports = {
    lists: (req, res, next) => {
        req.service.files.list({
            pageSize: 10,
            // fields: " files(id, name,corpus)"
        }, (err, response)=> {
            if (err) {
                console.log(err);
                return res.json(req.error("Error while fetching lists from drive"));
            }
            var dir = _.where(response.files, {mimeType: 'application/vnd.google-apps.folder'});
            return res.json(req.success(dir));
        });
    },
    upload: (req, res)=> {
        email = new Email();
        if (req.query.email) {
            email.setFrom("FileToDrive");
            email.setTo(req.query.email);
            email.init();
        }

        var current_client;
        if (req.cookies.id) {
            current_client = _.findWhere(clientLists, {id: req.cookies.id});
        }

        if (!req.query.url) {
            return res.json(req.error("No any url found"));
        }

        var decodedURIName =decodeURIComponent(path.basename(req.query.url));
        var googleRequestMetaData = {
            url: ' https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            headers: {
                Authorization : "Bearer " + req.cookies.access_token.access_token
            },
        }

        var progress = progressStream({
            time: 1000
        }, progress => {
            var per = Math.round(progress.percentage);
            progress.percentage = per;
            progress.transferred = prettysize(progress.transferred);
            progress.remaining = prettysize(progress.remaining);
		progress.graph = progress.speed;
            progress.speed = prettysize(progress.speed) + "ps";
            if (progress.eta)
                progress.eta = prettyTime(progress.eta * 1000000000);
            current_client.emit('upload', {progress, fileId});
        });
        var fileId = undefined;
        var metaData = {};

        //First we visit the url
        var requestStream;
        try {
            requestStream = request.get(req.query.url);
        }
        catch (err) {
            emitMessage(current_client, "Wrong format of url or incomplete url", "warning");
            return res.json(req.error("Wrong format of url or incomplete url"));
        }
        requestStream
            .on('error', err => {
                console.log(err)
                return res.json(req.error("Invalid urls"));
            })
            .on('response', response => {
                //On Response we create headers and upload the file
                googleRequestMetaData.headers = _.extendOwn(googleRequestMetaData.headers,response.headers);
                googleRequestMetaData.headers["Authorization"] = "Bearer " + req.cookies.access_token.access_token;
                if (response.statusCode == 200) {
                    var metaData = response.headers;
                    metaData.name = decodeURIComponent(path.basename(req.query.url));
                    metaData.size = prettysize(response.headers['content-length'], true, true);
                    metaData.hash = crypto.createHmac('sha256', 'samundrakc').update(response.headers.name + Date.now()).digest('hex');
                    fileId = response.headers.hash;
                    res.json(req.success(metaData));
                    emitMessage(current_client, "File from url has been found, Uploading to Google Drive", "success");
                    progress.setLength(response.headers['content-length']);
                }
                else {
                    emitMessage(current_client, "This Url doesn't provide direct download " + decodedURIName, "danger");
                    return res.json(req.error("This Url doesn't provide direct download"));
                }
                googleRequestMetaData.headers = _.pick(googleRequestMetaData.headers, 'Authorization', 'content-type', 'content-length');
            })
            .pipe(progress)
            .pipe(request.post(googleRequestMetaData, (err, status, result)=> {
                // console.log(err,status,result)
                if (err) {
                    emitMessage(current_client, "Error uploading File of " + decodedURIName, "danger");
                    if (req.query.email) {
                        email.setSubject("Error uploading file");
                        email.setMessage("File you requested to upload to google drive from " + decodedURIName + " has been failed, You can try to upload file again");
                        email.send();
                    }
                    console.log(err);
                    return;
                }

                result = JSON.parse(result);
                if (result.hasOwnProperty('error')) {
                    emitMessage(current_client, "Error uploading File from " + decodedURIName, "danger");
                    emitMessage(current_client,result.errors.message + " Please authenticate again","warning");
                    if (req.query.email) {
                        email.setSubject("Error uploading file");
                        email.setMessage("File you requested to upload to google drive of " + decodedURIName + " has been failed, You can try to upload file again. Error message is " + result.error.message);
                        email.send();
                    }
                    return;
                }
                //After file has been upload we rename it
                var updation = {
                    url: 'https://www.googleapis.com/drive/v3/files/' + result.id,
                    method: 'PATCH',
                    headers: {
                        "Authorization": googleRequestMetaData.headers['Authorization'],
                        'Content-Type': 'application/json'
                    },
                    json: {
                        fileId: result.id,
                        name: decodeURIComponent(path.basename(req.query.url)),
                        mimeType: googleRequestMetaData.headers['content-type'],
                    }
                }
                emitMessage(current_client, "File has been uploaded proccessing is going on", "success");
                request(updation, (err, result) => {
                    if (err) {
                        console.log(err);
                        emitMessage(current_client, "Error uploading file of url " + decodedURIName, "danger");
                        if (req.query.email) {
                            email.setSubject("Error uploading file");
                            email.setMessage("File you requested to upload to google drive from " + decodedURIName + " has been failed, You can try to upload file again.");
                            email.send();
                        }
                        return;
                    }


                    if (result.hasOwnProperty('error')) {
                        console.log(result.error)
                        emitMessage(current_client, "Error uploading one file " + decodedURIName, "danger");
                        if (req.query.email) {
                            email.setSubject("Error uploading file");
                            email.setMessage("File you requested to upload to google drive from " +decodedURIName +" has been failed, You can try to upload file again. Error message is " + result.error.message);
                            email.send();
                        }
                        return;
                    }

                    emitMessage(current_client, "1 File has been uploaded ", "success");
                    if (req.query.email) {
                        email.setSubject("File Uploaded");
                        email.setMessage("File you requested to upload to google drive of " + decodedURIName + " has been uploaded succesfully");
                        email.setAttachment([{data:'<html><head> <style> #outlook a { padding: 0; } .ReadMsgBody { width: 100%; } .ExternalClass { width: 100%; } .ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height: 100%!important; } body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; } table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; } img { -ms-interpolation-mode: bicubic; } img { display: block; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; } a img { border: none; } a { text-decoration: none; color: #0DDDC2; } @media only screen and (max-device-width: 450px) { #content-wrapper, #body-wrapper { width: 100%!important; } .c-responsive-container { display: inline-block; width: 100% padding: 0 16px; } .c-table-responsive { width: 100%; } .button { width: 100%!important; max-width: 300px; } } </style> </head><body class="layouts-application_mailer" data-rc="layouts/application_mailer" style="font-family:"Helvetica Neue", "Arial", sans-serif;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;margin:0;padding:0;font-size:16px;line-height:24px"> <table cellspacing="0" cellpadding="0" border="0" width="100%" class="table" id="body-wrapper" style="border-collapse:collapse;table-layout:fixed;margin:0 auto;min-width:100% !important;width:100% !important"> <tr> <td style="border-collapse:collapse"> <div class=" mailers-global-header" data-rc="mailers/global/header"> <table cellspacing="0" cellpadding="0" border="0" width="100%" class="mailers-global-header__header-container " style="border-bottom:1px solid #eeeeee;margin-bottom:48px;border-collapse:collapse;min-width:100% !important;width:100% !important"> <tr> <td align="center" style="border-collapse:collapse;text-align:center"><h1 class="s-margin1" style="margin:0;margin-top:16px;margin-bottom:16px;margin-left:16px;margin-right:16px"> <a href="https://republic.co/?utm_campaign=user_mailer-signup_welcome&utm_medium=email&utm_source=user_mailer-signup_welcome&utm_term=image" style="text-decoration:none;color:#03A9F4"><img width="120" height="30" alt="Republic" title="Republic" src="cid:fd-logo" style="height:auto;line-height:100%;outline:none;text-decoration:none;display:inline-block;border:0 none"> </a> </h1> </td> </tr> </table> </div> <table cellspacing="0" cellpadding="16px" border="0" width="100%" class="c-responsive-container" style="border-collapse:collapse;min-width:100% !important;width:100% !important"> <tr> <td style="border-collapse:collapse"> <table cellspacing="0" cellpadding="0" border="0" width="450" class="table" id="content-wrapper" align="center" style="border-collapse:collapse;table-layout:fixed;margin:0 auto"> <tr> <td style="border-collapse:collapse"> <div class=" mailers-user_mailer-signup_welcome" data-rc="mailers/user_mailer/signup_welcome"> <p class="c-emailText" style="margin:0;font-size:16px;line-height:24px;color:#777777;text-align:center;font-weight:300;margin-bottom:16px"> <img width="75" height="68" src="c-id:welcome-pic" alt="Welcome" style="border:0 none;height:auto;line-height:100%;outline:none;text-decoration:none;display:inline-block"> </p><h1 class="c-emailTitle" style="margin:0;font-size:30px;line-height:48px;color:#333333;font-weight:200;text-align:center;margin-bottom:16px"> Hi you file " + decodedURIName +" has been uploaded to Google Drive! </h1> <p class="c-emailText" style="margin:0;font-size:16px;line-height:24px;color:#777777;text-align:center;font-weight:300;margin-bottom:16px">Our service is free as you know and always will be!</p> <p class="c-emailText s-paddingTop1" style="margin:0;padding-top:16px;font-size:16px;line-height:24px;color:#777777;text-align:center;font-weight:300;margin-bottom:16px"> <a target="_blank" class="button" style="color:#03A9F4;border-radius:3px;display:inline-block;font-size:16px;line-height:50px;height:50px;text-align:center;text-decoration:none;-webkit-text-size-adjust:none;mso-hide:all;color:#fefefe;background-color:#222222;border:1px solid #222222;width:250px;background-color: #03A9F4; border: 1px solid #03A9F4; color: #ffffff; width: 240px; height: 48px; line-height: 48px" href="https://www.facebook.com/File-To-Drive-217169682367060/">Favour us with a Facebook Like</a> </p> <hr class="s-marginTop3 s-marginBottom2" style="margin-top:15px;margin-bottom:16px;border:0;border-top:1px solid #eeeeee;margin-bottom:22px;margin-top:48px"> <table cellspacing="0" cellpadding="0" border="0" width="400" class="table" align="center" style="border-collapse:collapse"> <tr> <td valign="middle" style="border-collapse:collapse;vertical-align:middle"> <img width="64px" height="64px" class="s-marginTop0_5" src="c-id:ig-logo" alt="Learn" style="margin-top:8px;border:0 none;height:auto;line-height:100%;outline:none;text-decoration:none;display:inline-block"> </td> <td class="s-paddingLeft2 s-paddingVert1" style="padding-top:16px;padding-bottom:16px;padding-left:32px;border-collapse:collapse"> <div class="s-fontSize22 u-colorGray2 u-fontWeight300" style="font-size:22px;line-height:32px;font-weight:300;color:#222222">We are on instagram</div> <div class="u-colorGray8 s-marginTop0_5 u-fontWeight300 s-fontSize17" style="font-size:17px;line-height:32px;margin-top:8px;font-weight:300;color:#888888">Be a part on filetodrive"s insta community by clicking <a href="https://instagram.com" target="_blank">here</a>.</div> </td> </tr> <tr> <td valign="middle" style="border-collapse:collapse;vertical-align:middle"> <img width="64px" height="64px" class="s-marginTop0_5" src="c-id:tw-logo" alt="Invest" style="margin-top:8px;border:0 none;height:auto;line-height:100%;outline:none;text-decoration:none;display:inline-block"> </td> <td class="s-paddingLeft2 s-paddingVert1" style="padding-top:16px;padding-bottom:16px;padding-left:32px;border-collapse:collapse"> <div class="s-fontSize22 u-colorGray2 u-fontWeight300" style="font-size:22px;line-height:32px;font-weight:300;color:#222222">Get our System Status Updates on Twitter</div> <div class="u-colorGray8 s-marginTop0_5 u-fontWeight300 s-fontSize17" style="font-size:17px;line-height:32px;margin-top:8px;font-weight:300;color:#888888">Whenever there is a feature update or system outage, get notified by our <a href="" target="_blank">tweet</a>.</div> </td> </tr> </table> <p class="s-marginTop1 u-text-center s-fontSize14 u-colorGrayA" style="margin:0;font-size:14px;line-height:24px;margin-top:2px;text-align:center;color:#AAAAAA">Have any questions then we are always there for you. <a class="c-link c-link--muted" target="_blank" href="https://www.facebook.com/File-To-Drive-217169682367060/" style="color:#777777;text-decoration:none;color:#03A9F4">Message Us »</a> </p> </div> </td> </tr> </table> </td> </tr> </table> </td> </tr></table</body></html>', alternative:true},{path:"welcome.png", type:"image/png", headers:{"Content-ID":"<welcome-pic>"}},{path:"twitter.svg", type:"image/svg", headers:{"Content-ID":"<tw-logo>"}},{path:"instagram.svg", type:"image/svg", headers:{"Content-ID":"<ig-logo>"}},{path:"nav_logo.svg", type:"image/svg", headers:{"Content-ID":"<fd-logo>"}}]);
                        email.send();
                    }
                });
            }));

    }
}

function emitMessage(socket, message, type) {
    socket.emit('userMessage', {message, type})
}
