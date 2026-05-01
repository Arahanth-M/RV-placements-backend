import User from "../models/User.js";
import User1 from "../models/User1.js";

export function getAuthUserModel(req) {
  return req?.user?.isAdminSession === true ? User : User1;
}

export default getAuthUserModel;
