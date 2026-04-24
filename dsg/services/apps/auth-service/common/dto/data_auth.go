package dto

// DataResourceAuthReq 数据资源授权申请请求
type DataResourceAuthReqArg struct {
	ResouceID []string `json:"resouce_id" binding:"required,min=1,max=100,dive,uuid"` //申请资源ID列表
	DataResourceAuthRequest
}

type DataResourceAuthRequest struct {
	ApplyType      string   `json:"apply_type" binding:"required,oneof=check query"` //申请类型
	Applicant      string   `json:"applicant" binding:"required,uuid"`               //申请人
	ApplicantName  string   `json:"applicant_name" binding:"required"`               //申请人名称
	ApplicantType  string   `json:"applicant_type" binding:"required"`               //申请人类型
	AuthOperations []string `json:"auth_operations" binding:"omitempty"`             //授权操作列表
	ExpiredAt      int64    `json:"expired_at" binding:"required,unix"`              //权限过期时间时间戳
}
