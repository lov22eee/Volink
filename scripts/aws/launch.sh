#!/usr/bin/env bash
# Run once in AWS CloudShell (console bottom-left "CloudShell"). Creates the demo server:
# security group (80/443 open, 22 only for EC2 Instance Connect), Elastic IP, Ubuntu 24.04 EC2.
# The server installs itself (server-setup.sh). No AWS key or password is printed or stored here.
set -euo pipefail
REGION="${REGION:-ap-southeast-2}"   # Free plan accounts are locked to their first region (Sydney for this team).
REF="${REF:-main}"
TYPE="${TYPE:-t3.small}"
REPO="https://github.com/lov22eee/Volink.git"
export AWS_DEFAULT_REGION="$REGION" AWS_REGION="$REGION"

existing=$(aws ec2 describe-instances --filters Name=tag:Name,Values=volink Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "$existing" ]; then
  echo "이미 volink 서버가 있습니다: $existing (새로 만들지 않음)"; exit 0
fi

ami=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
vpc=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
sg=$(aws ec2 describe-security-groups --filters Name=group-name,Values=volink-web Name=vpc-id,Values="$vpc" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$sg" = None ]; then
  sg=$(aws ec2 create-security-group --group-name volink-web --description "Volink web: 80/443 public, 22 Instance Connect only" --vpc-id "$vpc" --query GroupId --output text)
  connect=$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values="com.amazonaws.$REGION.ec2-instance-connect" --query 'PrefixLists[0].PrefixListId' --output text)
  aws ec2 authorize-security-group-ingress --group-id "$sg" --ip-permissions \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' \
    "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$connect}]" >/dev/null
fi

read -r alloc ip < <(aws ec2 allocate-address --domain vpc --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=volink}]' \
  --query '[AllocationId,PublicIp]' --output text)
cleanup() { echo "실패: 탄력적 IP를 반납합니다."; aws ec2 release-address --allocation-id "$alloc" || true; }
trap cleanup ERR
domain="${ip//./-}.sslip.io"

userdata=$(mktemp)
cat > "$userdata" <<USERDATA
#!/bin/bash
set -eu
exec >>/var/log/volink-setup.log 2>&1
mkdir -p /etc/volink
echo "$domain" > /etc/volink/domain
echo "$REF" > /etc/volink/ref
apt-get update -q && apt-get install -yq git
git clone --branch "$REF" "$REPO" /opt/volink
bash /opt/volink/scripts/aws/server-setup.sh
USERDATA

launch() {
  aws ec2 run-instances --image-id "$ami" --instance-type "$1" --security-group-ids "$sg" \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}' \
    --metadata-options HttpTokens=required --user-data "file://$userdata" \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=volink}]' --query 'Instances[0].InstanceId' --output text
}
instance=$(launch "$TYPE" 2>/dev/null || { echo "$TYPE 불가 → t3.micro로 시도" >&2; launch t3.micro; })
echo "서버 시작 중: $instance"
aws ec2 wait instance-running --instance-ids "$instance"
aws ec2 associate-address --instance-id "$instance" --allocation-id "$alloc" >/dev/null
trap - ERR
rm -f "$userdata"
echo
echo "완료. 서버가 스스로 설치하는 데 15~20분 걸립니다."
echo "주소: https://$domain"
echo "고정 IP: $ip"
